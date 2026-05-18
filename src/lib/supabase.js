import { createClient } from '@supabase/supabase-js';

// Vite-style env vars. Set these in .env.local at repo root:
//   VITE_SUPABASE_URL=https://xxxxx.supabase.co
//   VITE_SUPABASE_ANON_KEY=eyJhbGc...
//
// Session 5: auth is now on. RLS policies in 04_rls_authed.sql gate every
// table read on is_allowed(), which checks the JWT email against access_allowlist.

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Missing Supabase env vars. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local'
  );
}

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,        // keep the user signed in across reloads
    autoRefreshToken: true,      // rotate the JWT before it expires
    detectSessionInUrl: true,    // pick up tokens from the OAuth redirect hash
    flowType: 'pkce'             // recommended for SPAs
  }
});