// ============================================================
// Foodie Coaches AI Dashboard — Health Check Worker
// ============================================================
// Two entry points:
//   1. scheduled()  — cron-triggered daily at 7am AEST (21:00 UTC prev day)
//   2. fetch()      — manual "Check now" endpoint from the UI
//
// Both call runHealthChecks() which:
//   - Queries Supabase for items with non-null endpoints
//   - Pings each (HTTP GET or n8n/Make webhook POST, based on URL shape)
//   - Inserts a row into health_checks
//   - Updates items.health_status + items.last_health_check + items.last_error
//
// Uses service_role key to bypass RLS. Never expose that key to the browser.
//
// Required secrets (set with `wrangler secret put NAME`):
//   SUPABASE_URL          — e.g. https://xxxxx.supabase.co (NO trailing slash)
//   SUPABASE_SERVICE_KEY  — service_role key from Supabase project settings
//   WORKER_SECRET         — shared secret the React app sends in x-worker-secret
// ============================================================

const HEALTH_GREEN = 'green';
const HEALTH_AMBER = 'amber';
const HEALTH_RED = 'red';

// 5s ceiling per check — keeps the whole cron job under Worker CPU limits
// even if a couple of endpoints hang.
const CHECK_TIMEOUT_MS = 5000;

export default {
  // -----------------------------------------------------------
  // Cron entry: runs daily at 21:00 UTC = 7am AEST
  // -----------------------------------------------------------
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runHealthChecks(env, { trigger: 'cron' }));
  },

  // -----------------------------------------------------------
  // HTTP entry: manual checks from the UI + healthcheck endpoint
  // -----------------------------------------------------------
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS preflight — needed because the React app calls this cross-origin
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // GET / — sanity check, no auth needed
    if (url.pathname === '/' && request.method === 'GET') {
      return json({ ok: true, service: 'fc-health-worker' });
    }

    // POST /check — runs checks. Optional ?item_id=<uuid> to check just one.
    if (url.pathname === '/check' && request.method === 'POST') {
      const auth = request.headers.get('x-worker-secret');
      if (!auth || auth !== env.WORKER_SECRET) {
        return json({ error: 'unauthorized' }, 401);
      }

      const itemId = url.searchParams.get('item_id') || null;
      const result = await runHealthChecks(env, { trigger: 'manual', itemId });
      return json(result);
    }

    return json({ error: 'not found' }, 404);
  }
};

// ============================================================
// Core: fetch endpoints, ping them, write results back
// ============================================================
async function runHealthChecks(env, { trigger, itemId = null }) {
  const startedAt = new Date().toISOString();
  const sb = supabaseClient(env);

  // Pull modules with endpoints. (Projects don't have endpoints — only modules
  // do per the schema. Filtering on endpoint NOT NULL handles both cases.)
  let query = `${env.SUPABASE_URL}/rest/v1/items?select=id,name,endpoint&endpoint=not.is.null`;
  if (itemId) query += `&id=eq.${itemId}`;

  const itemsRes = await sb.fetch(query);
  if (!itemsRes.ok) {
    const body = await itemsRes.text();
    return { ok: false, error: `Supabase fetch failed: ${itemsRes.status} ${body}` };
  }
  const items = await itemsRes.json();

  if (items.length === 0) {
    return { ok: true, trigger, checked: 0, message: 'no items with endpoints' };
  }

  // Run all checks in parallel — they're independent and we want this fast.
  const results = await Promise.all(items.map(item => checkOne(item)));

  // Write results back. Two writes per item: insert into health_checks,
  // update items. Done in parallel across items but sequenced per item.
  await Promise.all(results.map(r => persistResult(sb, env, r)));

  return {
    ok: true,
    trigger,
    startedAt,
    finishedAt: new Date().toISOString(),
    checked: results.length,
    summary: {
      green: results.filter(r => r.status === HEALTH_GREEN).length,
      amber: results.filter(r => r.status === HEALTH_AMBER).length,
      red:   results.filter(r => r.status === HEALTH_RED).length
    },
    results: results.map(r => ({
      id: r.itemId, name: r.name, status: r.status,
      response_time_ms: r.responseTimeMs, error: r.errorMessage
    }))
  };
}

// ============================================================
// Per-item check: dispatch by URL shape
// ============================================================
async function checkOne(item) {
  const t0 = Date.now();
  const base = { itemId: item.id, name: item.name, endpoint: item.endpoint };

  try {
    const strategy = pickStrategy(item.endpoint);
    const { status, error } = await strategy(item.endpoint);
    return { ...base, status, errorMessage: error, responseTimeMs: Date.now() - t0 };
  } catch (err) {
    return {
      ...base,
      status: HEALTH_RED,
      errorMessage: err.message || String(err),
      responseTimeMs: Date.now() - t0
    };
  }
}

// Return the right ping function for this endpoint URL.
// Extend here as new endpoint types are added.
function pickStrategy(endpoint) {
  const url = endpoint.toLowerCase();

  // n8n webhooks: contain /webhook/ or /webhook-test/ in the path
  if (url.includes('/webhook/') || url.includes('/webhook-test/')) {
    return pingWebhookPost;
  }

  // Make.com webhooks: hook.<region>.make.com
  if (/hook\.[a-z0-9-]+\.make\.com/.test(url)) {
    return pingWebhookPost;
  }

  // Default: plain GET. Treats 2xx/3xx as green, 4xx as amber, 5xx/timeout as red.
  return pingHttpGet;
}

// ------------------------------------------------------------
// Strategy: plain HTTP GET
// 2xx/3xx => green, 4xx => amber (endpoint exists but rejecting), 5xx => red
// ------------------------------------------------------------
async function pingHttpGet(endpoint) {
  const res = await fetchWithTimeout(endpoint, { method: 'GET' });
  if (res.status >= 200 && res.status < 400) {
    return { status: HEALTH_GREEN, error: null };
  }
  if (res.status >= 400 && res.status < 500) {
    return { status: HEALTH_AMBER, error: `HTTP ${res.status}` };
  }
  return { status: HEALTH_RED, error: `HTTP ${res.status}` };
}

// ------------------------------------------------------------
// Strategy: webhook POST (n8n / Make.com)
// We POST a small "health check" payload. n8n's webhook node returns 200 if
// the workflow exists and is active; Make.com returns 200 if the scenario
// is on. Both return 404 when the webhook is unregistered or scenario off.
// ------------------------------------------------------------
async function pingWebhookPost(endpoint) {
  const res = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ healthcheck: true, source: 'fc-dashboard-worker' })
  });
  if (res.status >= 200 && res.status < 400) {
    return { status: HEALTH_GREEN, error: null };
  }
  if (res.status === 404) {
    return { status: HEALTH_RED, error: 'Webhook not registered (404)' };
  }
  if (res.status >= 400 && res.status < 500) {
    return { status: HEALTH_AMBER, error: `HTTP ${res.status}` };
  }
  return { status: HEALTH_RED, error: `HTTP ${res.status}` };
}

// ------------------------------------------------------------
// fetch with AbortController-based timeout
// ------------------------------------------------------------
async function fetchWithTimeout(url, opts = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), CHECK_TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: ac.signal });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Timeout after ${CHECK_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================
// Persistence: write to health_checks + update items
// ============================================================
async function persistResult(sb, env, r) {
  // 1. Append to health_checks log
  const logRes = await sb.fetch(`${env.SUPABASE_URL}/rest/v1/health_checks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({
      item_id: r.itemId,
      status: r.status,
      response_time_ms: r.responseTimeMs,
      error_message: r.errorMessage
    })
  });
  if (!logRes.ok) {
    console.error(`health_checks insert failed for ${r.itemId}:`, await logRes.text());
  }

  // 2. Update the item's latest snapshot
  const patchRes = await sb.fetch(
    `${env.SUPABASE_URL}/rest/v1/items?id=eq.${r.itemId}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({
        health_status: r.status,
        last_health_check: new Date().toISOString(),
        last_error: r.errorMessage
      })
    }
  );
  if (!patchRes.ok) {
    console.error(`items patch failed for ${r.itemId}:`, await patchRes.text());
  }
}

// ============================================================
// Tiny Supabase REST helper — service_role key only
// ============================================================
function supabaseClient(env) {
  const headers = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`
  };
  return {
    fetch: (url, opts = {}) =>
      fetch(url, { ...opts, headers: { ...headers, ...(opts.headers || {}) } })
  };
}

// ============================================================
// HTTP helpers
// ============================================================
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*', // tighten in Session 7 to the prod domain
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-worker-secret'
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  });
}