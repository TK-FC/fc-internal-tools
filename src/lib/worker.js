// ============================================================
// Worker client — talks to fc-health-worker
// ============================================================
// Session 5 update: auth swapped from shared-secret to Supabase JWT.
// We grab the current session and forward its access_token as
// Authorization: Bearer <jwt>. The Worker verifies it and checks the
// JWT's email against access_allowlist.
//
// VITE_WORKER_SECRET is gone — delete it from .env.local after this works.
//
// Env vars (set in .env.local at repo root):
//   VITE_WORKER_URL = https://fc-health-worker.<sub>.workers.dev
// ============================================================

import { supabase } from './supabase';

const WORKER_URL = import.meta.env.VITE_WORKER_URL;

function ensureConfigured() {
  if (!WORKER_URL) {
    throw new Error('Worker not configured. Set VITE_WORKER_URL in .env.local');
  }
}

/**
 * Trigger a manual health check.
 * @param {string} [itemId] - Optional item UUID. Omit to check everything.
 * @returns {Promise<object>} Worker response — see runHealthChecks() return shape.
 */
export async function triggerHealthCheck(itemId = null) {
  ensureConfigured();

  // Pull the live session — auto-refreshed by supabase-js, so the token
  // we send is always current.
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('Not signed in. Refresh the page and sign in again.');
  }

  const url = itemId
    ? `${WORKER_URL}/check?item_id=${encodeURIComponent(itemId)}`
    : `${WORKER_URL}/check`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}` }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Worker returned ${res.status}: ${body}`);
  }
  return res.json();
}