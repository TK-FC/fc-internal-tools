import { createClient } from '@supabase/supabase-js';

// Vite-style env vars. Set these in .env.local at repo root:
//   VITE_SUPABASE_URL=https://xxxxx.supabase.co
//   VITE_SUPABASE_ANON_KEY=eyJhbGc...
//
// Anon key is fine here — RLS is on and currently allows public read.
// Writes are locked to service_role (used only by the Cloudflare Worker in Session 4).

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Throw early so we don't get cryptic "fetch failed" errors later.
  throw new Error(
    'Missing Supabase env vars. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local'
  );
}

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: false } // No auth yet — Session 5 turns this on
});