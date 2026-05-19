// ============================================================
// Foodie Coaches AI Dashboard — Health Check + CRUD Worker
// ============================================================
// Entry points:
//   1. scheduled()       — cron daily 7am AEST, runs health checks
//   2. fetch()           — HTTP API:
//        GET  /                       — sanity check (no auth)
//        POST /check                  — manual health check (auth)
//        POST /projects               — create project (auth + audit)
//        PATCH /projects/:id          — update project (auth + audit)
//        DELETE /projects/:id         — soft delete project (auth + audit)
//        POST /projects/:id/restore   — un-archive project (auth + audit)
//        POST /modules                — create module (auth + audit)
//        PATCH /modules/:id           — update module (auth + audit)
//        DELETE /modules/:id          — soft delete module (auth + audit)
//        POST /modules/:id/restore    — un-archive module (auth + audit)
//
// All write endpoints:
//   - Require Authorization: Bearer <Supabase JWT>
//   - Verify JWT (ES256 via Supabase JWKS), check allowlist
//   - Read the existing row first (so audit_log has a 'before' snapshot)
//   - Apply the change via service_role
//   - Write one row to audit_log with email + action + before/after diff
//
// Required secrets (set with `wrangler secret put NAME`):
//   SUPABASE_URL           — e.g. https://xxxxx.supabase.co (NO trailing slash)
//   SUPABASE_SERVICE_KEY   — service_role key
//   (SUPABASE_JWT_SECRET is no longer used — safe to delete after deploy)
// ============================================================

const HEALTH_GREEN = 'green';
const HEALTH_AMBER = 'amber';
const HEALTH_RED = 'red';

const CHECK_TIMEOUT_MS = 5000;

// Allowed browser origins. Add staging/preview URLs here if needed.
const ALLOWED_ORIGINS = [
  'https://tk-fc.github.io',
  'http://localhost:5173'
];

// Whitelist of fields the client is allowed to write per type. Anything
// not in this list is dropped silently — protects health_status,
// last_health_check, created_at, etc. from being overwritten by the UI.
const PROJECT_WRITABLE = new Set([
  'name', 'category', 'owner', 'stage', 'stage_mode', 'description',
  'brief', 'wish_list', 'project_link', 'monthly_cost', 'calls_this_month',
  'sort_order'
]);
const MODULE_WRITABLE = new Set([
  'name', 'stage', 'module_brief', 'endpoint', 'sort_order', 'parent_id'
]);

export default {
  // -----------------------------------------------------------
  // Cron: daily 21:00 UTC = 7am AEST
  // -----------------------------------------------------------
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runHealthChecks(env, { trigger: 'cron' }));
  },

  // -----------------------------------------------------------
  // HTTP router
  // -----------------------------------------------------------
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    // GET / — sanity check, no auth
    if (url.pathname === '/' && request.method === 'GET') {
      return json(request, { ok: true, service: 'fc-health-worker' });
    }

    // Everything below requires auth
    const authResult = await authenticate(request, env);
    if (!authResult.ok) {
      return json(request, { error: authResult.error }, authResult.status);
    }
    const { email } = authResult;

    // POST /check
    if (url.pathname === '/check' && request.method === 'POST') {
      const itemId = url.searchParams.get('item_id') || null;
      const result = await runHealthChecks(env, {
        trigger: 'manual', itemId, triggeredBy: email
      });
      return json(request, result);
    }

    // ---- Projects ----
    if (url.pathname === '/projects' && request.method === 'POST') {
      return handleCreate(request, env, email, 'project');
    }
    let m = url.pathname.match(/^\/projects\/([0-9a-f-]{36})$/i);
    if (m && request.method === 'PATCH')  return handleUpdate(request, env, email, 'project', m[1]);
    if (m && request.method === 'DELETE') return handleArchive(request, env, email, 'project', m[1], true);
    m = url.pathname.match(/^\/projects\/([0-9a-f-]{36})\/restore$/i);
    if (m && request.method === 'POST')   return handleArchive(request, env, email, 'project', m[1], false);

    // ---- Modules ----
    if (url.pathname === '/modules' && request.method === 'POST') {
      return handleCreate(request, env, email, 'module');
    }
    m = url.pathname.match(/^\/modules\/([0-9a-f-]{36})$/i);
    if (m && request.method === 'PATCH')  return handleUpdate(request, env, email, 'module', m[1]);
    if (m && request.method === 'DELETE') return handleArchive(request, env, email, 'module', m[1], true);
    m = url.pathname.match(/^\/modules\/([0-9a-f-]{36})\/restore$/i);
    if (m && request.method === 'POST')   return handleArchive(request, env, email, 'module', m[1], false);

    return json(request, { error: 'not found' }, 404);
  }
};

// ============================================================
// CRUD HANDLERS
// ============================================================

async function handleCreate(request, env, email, type) {
  let body;
  try { body = await request.json(); }
  catch { return json(request, { error: 'invalid JSON body' }, 400); }

  // Strip to writable fields + force type
  const writable = type === 'project' ? PROJECT_WRITABLE : MODULE_WRITABLE;
  const row = { type };
  for (const [k, v] of Object.entries(body)) {
    if (writable.has(k)) row[k] = v;
  }

  // Required fields per type
  if (!row.name || !row.name.trim()) {
    return json(request, { error: 'name is required' }, 400);
  }
  if (type === 'project') {
    if (!row.category) return json(request, { error: 'category is required' }, 400);
    if (!row.owner)    return json(request, { error: 'owner is required' }, 400);
    if (!row.stage_mode) row.stage_mode = 'manual';
    if (!row.stage)      row.stage = 'ideation';
  } else {
    if (!row.parent_id) return json(request, { error: 'parent_id is required for modules' }, 400);
    if (!row.stage)     row.stage = 'ideation';
  }

  // sort_order default: put it at the end of its group
  if (row.sort_order == null) {
    row.sort_order = await nextSortOrder(env, type, row.parent_id || null);
  }

  const sb = supabaseClient(env);
  const res = await sb.fetch(`${env.SUPABASE_URL}/rest/v1/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(row)
  });

  if (!res.ok) {
    const text = await res.text();
    return json(request, { error: `insert failed: ${res.status} ${text}` }, 500);
  }
  const inserted = (await res.json())[0];

  await writeAudit(env, {
    email,
    action: `${type}.create`,
    resource_id: inserted.id,
    resource_type: type,
    details: { after: inserted }
  });

  return json(request, { ok: true, item: inserted });
}

async function handleUpdate(request, env, email, type, id) {
  let body;
  try { body = await request.json(); }
  catch { return json(request, { error: 'invalid JSON body' }, 400); }

  // Read the 'before' for the audit log
  const before = await fetchItem(env, id);
  if (!before) return json(request, { error: 'not found' }, 404);
  if (before.type !== type) {
    return json(request, { error: `id is a ${before.type}, not a ${type}` }, 400);
  }

  // Strip to writable fields
  const writable = type === 'project' ? PROJECT_WRITABLE : MODULE_WRITABLE;
  const patch = {};
  for (const [k, v] of Object.entries(body)) {
    if (writable.has(k)) patch[k] = v;
  }
  if (Object.keys(patch).length === 0) {
    return json(request, { error: 'no writable fields in body' }, 400);
  }

  const sb = supabaseClient(env);
  const res = await sb.fetch(
    `${env.SUPABASE_URL}/rest/v1/items?id=eq.${id}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify(patch)
    }
  );
  if (!res.ok) {
    const text = await res.text();
    return json(request, { error: `update failed: ${res.status} ${text}` }, 500);
  }
  const after = (await res.json())[0];

  // Compute diff so audit_log isn't bloated with unchanged fields
  const diff = {};
  for (const k of Object.keys(patch)) {
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) {
      diff[k] = { from: before[k], to: after[k] };
    }
  }

  await writeAudit(env, {
    email,
    action: `${type}.update`,
    resource_id: id,
    resource_type: type,
    details: { changed: diff }
  });

  return json(request, { ok: true, item: after });
}

// Soft delete (archived = true) or restore (archived = false)
async function handleArchive(request, env, email, type, id, archive) {
  const before = await fetchItem(env, id);
  if (!before) return json(request, { error: 'not found' }, 404);
  if (before.type !== type) {
    return json(request, { error: `id is a ${before.type}, not a ${type}` }, 400);
  }
  if (before.archived === archive) {
    return json(request, { ok: true, item: before, message: archive ? 'already archived' : 'already active' });
  }

  const sb = supabaseClient(env);

  // For projects, cascade the archive flag to child modules so the UI
  // stays consistent. (Cascade only on archive — restore only touches
  // the parent, since some children might have been individually archived
  // before and the user might not want them all back.)
  if (type === 'project' && archive) {
    const cascadeRes = await sb.fetch(
      `${env.SUPABASE_URL}/rest/v1/items?parent_id=eq.${id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ archived: true })
      }
    );
    if (!cascadeRes.ok) {
      console.error(`cascade archive failed for ${id}:`, await cascadeRes.text());
      // Continue anyway — the parent archive is the main intent
    }
  }

  const res = await sb.fetch(
    `${env.SUPABASE_URL}/rest/v1/items?id=eq.${id}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ archived: archive })
    }
  );
  if (!res.ok) {
    const text = await res.text();
    return json(request, { error: `archive failed: ${res.status} ${text}` }, 500);
  }
  const after = (await res.json())[0];

  await writeAudit(env, {
    email,
    action: archive ? `${type}.archive` : `${type}.restore`,
    resource_id: id,
    resource_type: type,
    details: {
      name: before.name,
      cascaded: type === 'project' && archive ? true : undefined
    }
  });

  return json(request, { ok: true, item: after });
}

// ============================================================
// CRUD HELPERS
// ============================================================

async function fetchItem(env, id) {
  const sb = supabaseClient(env);
  const res = await sb.fetch(
    `${env.SUPABASE_URL}/rest/v1/items?id=eq.${id}&select=*`
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0] || null;
}

// Next sort_order = max(existing in this group) + 1
async function nextSortOrder(env, type, parentId) {
  const sb = supabaseClient(env);
  const filter = type === 'project'
    ? 'type=eq.project&parent_id=is.null'
    : `type=eq.module&parent_id=eq.${parentId}`;
  const res = await sb.fetch(
    `${env.SUPABASE_URL}/rest/v1/items?${filter}&select=sort_order&order=sort_order.desc&limit=1`
  );
  if (!res.ok) return 0;
  const rows = await res.json();
  return rows.length === 0 ? 0 : (rows[0].sort_order ?? 0) + 1;
}

async function writeAudit(env, entry) {
  const sb = supabaseClient(env);
  const res = await sb.fetch(`${env.SUPABASE_URL}/rest/v1/audit_log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(entry)
  });
  if (!res.ok) {
    // Don't fail the user-visible request because audit failed — just log.
    console.error('audit_log insert failed:', await res.text());
  }
}

// ============================================================
// AUTH: verify Supabase ES256 JWT via JWKS + check allowlist
// ============================================================

// Module-scope cache for the JWKS. Survives across requests on the same
// Worker instance but resets on cold start. JWKS rarely changes and a
// cold-start refresh costs ~50ms, so 1-hour TTL is fine.
let jwksCache = null;
let jwksCacheAt = 0;
const JWKS_TTL_MS = 60 * 60 * 1000;

async function getJwks(env) {
  const now = Date.now();
  if (jwksCache && now - jwksCacheAt < JWKS_TTL_MS) return jwksCache;

  const url = `${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`;
  const res = await fetch(url, {
    headers: { apikey: env.SUPABASE_SERVICE_KEY }
  });
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  jwksCache = await res.json();
  jwksCacheAt = now;
  return jwksCache;
}

async function authenticate(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return { ok: false, error: 'missing bearer token', status: 401 };
  }
  const token = authHeader.slice(7);

  let payload;
  try {
    payload = await verifyJwt(token, env);
  } catch (e) {
    return { ok: false, error: `invalid token: ${e.message}`, status: 401 };
  }

  const email = (payload.email || '').toLowerCase();
  if (!email) {
    return { ok: false, error: 'no email claim', status: 401 };
  }

  // Belt-and-braces: enforce the @foodiecoaches.com cap server-side too.
  if (!email.endsWith('@foodiecoaches.com')) {
    return { ok: false, error: 'domain not allowed', status: 403 };
  }

  // Check allowlist
  const sb = supabaseClient(env);
  const res = await sb.fetch(
    `${env.SUPABASE_URL}/rest/v1/access_allowlist?email=eq.${encodeURIComponent(email)}&active=eq.true&select=email`
  );
  if (!res.ok) {
    return { ok: false, error: 'allowlist check failed', status: 500 };
  }
  const rows = await res.json();
  if (rows.length === 0) {
    return { ok: false, error: 'not on allowlist', status: 403 };
  }

  return { ok: true, email };
}

async function verifyJwt(token, env) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed token');

  const [headerB64, payloadB64, signatureB64] = parts;
  const header = JSON.parse(base64UrlDecodeToString(headerB64));
  const payload = JSON.parse(base64UrlDecodeToString(payloadB64));

  if (header.alg !== 'ES256') {
    throw new Error(`unexpected alg ${header.alg}`);
  }

  // Find matching key in JWKS by kid
  const jwks = await getJwks(env);
  const jwk = jwks.keys.find(k => k.kid === header.kid);
  if (!jwk) throw new Error(`no matching key for kid ${header.kid}`);

  // Import the public key for ECDSA verification
  const publicKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify']
  );

  // Verify the signature
  const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = base64UrlDecode(signatureB64);

  const valid = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    publicKey,
    signature,
    signingInput
  );
  if (!valid) throw new Error('signature verification failed');

  // Check expiry
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) throw new Error('token expired');

  return payload;
}

// Base64url decode helpers — used by verifyJwt + JWKS verification
function base64UrlDecode(s) {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function base64UrlDecodeToString(s) {
  return new TextDecoder().decode(base64UrlDecode(s));
}

// ============================================================
// HEALTH CHECKS (unchanged from Session 5)
// ============================================================
async function runHealthChecks(env, { trigger, itemId = null, triggeredBy = null }) {
  const startedAt = new Date().toISOString();
  const sb = supabaseClient(env);

  // Skip archived items in the cron sweep
  let query = `${env.SUPABASE_URL}/rest/v1/items?select=id,name,endpoint&endpoint=not.is.null&archived=eq.false`;
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
    ok: true, trigger, triggeredBy, startedAt,
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
    return { ...base, status: HEALTH_RED, errorMessage: err.message || String(err), responseTimeMs: Date.now() - t0 };
  }
}

function pickStrategy(endpoint) {
  const url = endpoint.toLowerCase();
  if (url.includes('/webhook/') || url.includes('/webhook-test/')) return pingWebhookPost;
  if (/hook\.[a-z0-9-]+\.make\.com/.test(url)) return pingWebhookPost;
  return pingHttpGet;
}

async function pingHttpGet(endpoint) {
  const res = await fetchWithTimeout(endpoint, { 
    method: 'GET',
    headers: { 'User-Agent': 'fc-health-worker/1.0' }
  });
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
  try { return await fetch(url, { ...opts, signal: ac.signal }); }
  catch (err) {
    if (err.name === 'AbortError') throw new Error(`Timeout after ${CHECK_TIMEOUT_MS}ms`);
    throw err;
  } finally { clearTimeout(timer); }
}

async function persistResult(sb, env, r) {
  const logRes = await sb.fetch(`${env.SUPABASE_URL}/rest/v1/health_checks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({
      item_id: r.itemId, status: r.status,
      response_time_ms: r.responseTimeMs, error_message: r.errorMessage
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
// Supabase REST helper
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
function corsHeaders(request) {
  const origin = request?.headers.get('Origin');
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin'
  };
}

function json(request, body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
  });
}