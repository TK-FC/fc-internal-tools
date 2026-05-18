// ============================================================
// Worker client — talks to fc-health-worker
// ============================================================
// Env vars (set in .env.local at repo root):
//   VITE_WORKER_URL    = https://fc-health-worker.<sub>.workers.dev
//   VITE_WORKER_SECRET = same value you set with `wrangler secret put WORKER_SECRET`
//
// Note: the secret IS visible in the browser bundle. That's intentional for
// the pre-auth phase — it stops random internet traffic from hammering the
// Worker. Session 5 swaps this for an OAuth bearer token and the secret
// moves server-side.
// ============================================================

const WORKER_URL = import.meta.env.VITE_WORKER_URL;
const WORKER_SECRET = import.meta.env.VITE_WORKER_SECRET;

function ensureConfigured() {
  if (!WORKER_URL || !WORKER_SECRET) {
    throw new Error(
      'Worker not configured. Set VITE_WORKER_URL + VITE_WORKER_SECRET in .env.local'
    );
  }
}

/**
 * Trigger a manual health check.
 * @param {string} [itemId] - Optional item UUID. Omit to check everything.
 * @returns {Promise<object>} Worker response — see runHealthChecks() return shape.
 */
export async function triggerHealthCheck(itemId = null) {
  ensureConfigured();

  const url = itemId
    ? `${WORKER_URL}/check?item_id=${encodeURIComponent(itemId)}`
    : `${WORKER_URL}/check`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'x-worker-secret': WORKER_SECRET }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Worker returned ${res.status}: ${body}`);
  }
  return res.json();
}