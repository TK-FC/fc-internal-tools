// ============================================================
// CRUD client — wraps the Worker's project/module write endpoints.
// ============================================================
// All requests forward the live Supabase JWT as Authorization: Bearer ...
// The Worker verifies + checks the allowlist before letting any write through.
// ============================================================

import { supabase } from './supabase';

const WORKER_URL = import.meta.env.VITE_WORKER_URL;

async function authedFetch(path, opts = {}) {
  if (!WORKER_URL) throw new Error('Worker not configured. Set VITE_WORKER_URL in .env.local');

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('Not signed in. Refresh the page and sign in again.');
  }

  const res = await fetch(`${WORKER_URL}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      ...(opts.headers || {})
    }
  });

  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }

  if (!res.ok) {
    throw new Error(body.error || `Worker returned ${res.status}`);
  }
  return body;
}

// ---- Projects ----
export const createProject = (fields) =>
  authedFetch('/projects', { method: 'POST', body: JSON.stringify(fields) });

export const updateProject = (id, fields) =>
  authedFetch(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(fields) });

export const archiveProject = (id) =>
  authedFetch(`/projects/${id}`, { method: 'DELETE' });

export const restoreProject = (id) =>
  authedFetch(`/projects/${id}/restore`, { method: 'POST' });

// ---- Modules ----
export const createModule = (fields) =>
  authedFetch('/modules', { method: 'POST', body: JSON.stringify(fields) });

export const updateModule = (id, fields) =>
  authedFetch(`/modules/${id}`, { method: 'PATCH', body: JSON.stringify(fields) });

export const archiveModule = (id) =>
  authedFetch(`/modules/${id}`, { method: 'DELETE' });

export const restoreModule = (id) =>
  authedFetch(`/modules/${id}/restore`, { method: 'POST' });