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
// Auth (Session 5):
//   - scheduled() needs no auth — it's invoked by Cloudflare directly.
//   - fetch() POST /check requires Authorization: Bearer <Supabase JWT>.
//     The Worker verifies the JWT (HS256, signed with SUPABASE_JWT_SECRET),
//     reads the email claim, and checks it against access_allowlist via
//     the service_role key.
//
// Required secrets (set with `wrangler secret put NAME`):
//   SUPABASE_URL           — e.g. https://xxxxx.supabase.co (NO trailing slash)
//   SUPABASE_SERVICE_KEY   — service_role key from Supabase project settings
//   SUPABASE_JWT_SECRET    — JWT signing secret from Supabase API settings
// ============================================================

const HEALTH_GREEN = 'green';
const HEALTH_AMBER = 'amber';
const HEALTH_RED = 'red';

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

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // GET / — sanity check, no auth needed
    if (url.pathname === '/' && request.method === 'GET') {
      return json({ ok: true, service: 'fc-health-worker' });
    }

    // POST /check — runs checks. Optional ?item_id=<uuid>.
    if (url.pathname === '/check' && request.method === 'POST') {
      const authResult = await authenticate(request, env);
      if (!authResult.ok) {
        return json({ error: authResult.error }, authResult.status);
      }

      const itemId = url.searchParams.get('item_id') || null;
      const result = await runHealthChecks(env, {
        trigger: 'manual',
        itemId,
        triggeredBy: authResult.email
      });
      return json(result);
    }

    return json({ error: 'not found' }, 404);
  }
};

// ============================================================
// AUTH: verify Supabase JWT + check allowlist
// ============================================================
async function authenticate(request, env) {
  const header = request.headers.get('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return { ok: false, status: 401, error: 'missing bearer token' };
  }
  const token = match[1];

  let payload;
  try {
    payload = await verifyJwt(token, env.SUPABASE_JWT_SECRET);
  } catch (err) {
    return { ok: false, status: 401, error: `invalid token: ${err.message}` };
  }

  const email = (payload.email || '').toLowerCase();
  if (!email) {
    return { ok: false, status: 403, error: 'token has no email claim' };
  }

  // Belt-and-braces: enforce the @foodiecoaches.com cap server-side too.
  if (!email.endsWith('@foodiecoaches.com')) {
    return { ok: false, status: 403, error: 'domain not allowed' };
  }

  // Allowlist check via service_role — bypasses RLS, so this runs regardless
  // of whether the user could SELECT their own row.
  const sb = supabaseClient(env);
  const res = await sb.fetch(
    `${env.SUPABASE_URL}/rest/v1/access_allowlist?select=email,active&email=eq.${encodeURIComponent(email)}`
  );
  if (!res.ok) {
    return { ok: false, status: 500, error: 'allowlist check failed' };
  }
  const rows = await res.json();
  if (rows.length === 0 || rows[0].active !== true) {
    return { ok: false, status: 403, error: 'not on allowlist' };
  }

  return { ok: true, email };
}

// ------------------------------------------------------------
// Verify an HS256 JWT using Web Crypto. Returns the payload if valid.
// Throws on bad signature, malformed token, or expired token.
// ------------------------------------------------------------
async function verifyJwt(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed');
  const [headerB64, payloadB64, sigB64] = parts;

  const header = JSON.parse(b64UrlDecodeStr(headerB64));
  if (header.alg !== 'HS256') throw new Error(`unexpected alg ${header.alg}`);

  // Verify signature
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const data = enc.encode(`${headerB64}.${payloadB64}`);
  const sig = b64UrlDecodeBytes(sigB64);
  const valid = await crypto.subtle.verify('HMAC', key, sig, data);
  if (!valid) throw new Error('bad signature');

  // Parse payload + check expiry
  const payload = JSON.parse(b64UrlDecodeStr(payloadB64));
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && now >= payload.exp) throw new Error('expired');
  if (payload.nbf && now < payload.nbf) throw new Error('not yet valid');

  return payload;
}

function b64UrlDecodeStr(s) {
  return new TextDecoder().decode(b64UrlDecodeBytes(s));
}
function b64UrlDecodeBytes(s) {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ============================================================
// Core: fetch endpoints, ping them, write results back
// ============================================================
async function runHealthChecks(env, { trigger, itemId = null, triggeredBy = null }) {
  const startedAt = new Date().toISOString();
  const sb = supabaseClient(env);

  let query = `${env.SUPABASE_URL}/rest/v1/items?select=id,name,endpoint&endpoint=not.is.null`;
  if (itemId) query += `&id=eq.${itemId}`;

  const itemsRes = await sb.fetch(query);
  if (!itemsRes.ok) {
    const body = await itemsRes.text();
    return { ok: false, error: `Supabase fetch failed: ${itemsRes.status} ${body}` };
  }
  const items = await itemsRes.json();

  if (items.length === 0) {
    return { ok: true, trigger, triggeredBy, checked: 0, message: 'no items with endpoints' };
  }

  const results = await Promise.all(items.map(item => checkOne(item)));
  await Promise.all(results.map(r => persistResult(sb, env, r)));

  return {
    ok: true,
    trigger,
    triggeredBy,
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

function pickStrategy(endpoint) {
  const url = endpoint.toLowerCase();
  if (url.includes('/webhook/') || url.includes('/webhook-test/')) return pingWebhookPost;
  if (/hook\.[a-z0-9-]+\.make\.com/.test(url)) return pingWebhookPost;
  return pingHttpGet;
}

async function pingHttpGet(endpoint) {
  const res = await fetchWithTimeout(endpoint, { method: 'GET' });
  if (res.status >= 200 && res.status < 400) return { status: HEALTH_GREEN, error: null };
  if (res.status >= 400 && res.status < 500) return { status: HEALTH_AMBER, error: `HTTP ${res.status}` };
  return { status: HEALTH_RED, error: `HTTP ${res.status}` };
}

async function pingWebhookPost(endpoint) {
  const res = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ healthcheck: true, source: 'fc-dashboard-worker' })
  });
  if (res.status >= 200 && res.status < 400) return { status: HEALTH_GREEN, error: null };
  if (res.status === 404) return { status: HEALTH_RED, error: 'Webhook not registered (404)' };
  if (res.status >= 400 && res.status < 500) return { status: HEALTH_AMBER, error: `HTTP ${res.status}` };
  return { status: HEALTH_RED, error: `HTTP ${res.status}` };
}

async function fetchWithTimeout(url, opts = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), CHECK_TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: ac.signal });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`Timeout after ${CHECK_TIMEOUT_MS}ms`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function persistResult(sb, env, r) {
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
  if (!logRes.ok) console.error(`health_checks insert failed for ${r.itemId}:`, await logRes.text());

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
  if (!patchRes.ok) console.error(`items patch failed for ${r.itemId}:`, await patchRes.text());
}

// ============================================================
// Supabase REST helper — service_role key
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
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  });
}