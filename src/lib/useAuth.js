import { useEffect, useState } from 'react';
import { supabase } from './supabase';

// ============================================================
// useAuth — single source of truth for auth state in the app.
//
// Returns { status, user, session, signIn, signOut, error }
//
// status values:
//   'loading'              — initial check still in flight
//   'signed-out'           — no session
//   'signed-in-allowed'    — session + email is in active access_allowlist
//   'signed-in-pending'    — session but email NOT on allowlist (show pending screen)
//
// The allowlist check is a normal Supabase query. RLS lets the signed-in user
// see their own row only (policy "self read access_allowlist"). If the query
// returns a row → allowed. If it returns nothing → not allowed.
// ============================================================

export function useAuth() {
  const [status, setStatus] = useState('loading');
  const [session, setSession] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;

    // Initial session check (handles page-load + post-OAuth redirect)
    supabase.auth.getSession().then(({ data, error: sErr }) => {
      if (!active) return;
      if (sErr) {
        setError(sErr.message);
        setStatus('signed-out');
        return;
      }
      handleSession(data.session);
    });

    // Listen for sign-in / sign-out / token refresh
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      if (!active) return;
      handleSession(sess);
    });

    async function handleSession(sess) {
      setSession(sess);
      if (!sess) {
        setStatus('signed-out');
        return;
      }
      // Got a session. Check the allowlist.
      const email = sess.user?.email;
      if (!email) {
        // Shouldn't happen with Google but be safe.
        setStatus('signed-in-pending');
        return;
      }
      const { data: row, error: aErr } = await supabase
        .from('access_allowlist')
        .select('email, active')
        .eq('email', email.toLowerCase())
        .maybeSingle();

      if (!active) return;

      if (aErr) {
        console.error('[useAuth] allowlist check failed:', aErr);
        setError(aErr.message);
        setStatus('signed-in-pending');
        return;
      }
      if (row && row.active) {
        setStatus('signed-in-allowed');
      } else {
        setStatus('signed-in-pending');
      }
    }

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function signIn() {
    setError(null);
    const { error: sErr } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        // hd = Google-side hosted-domain restriction. Google refuses to issue
        // an ID token for any account outside foodiecoaches.com — the user
        // never even gets back to Supabase. Belt-and-braces with the OAuth
        // consent screen's "Internal" user-type setting.
        queryParams: { hd: 'foodiecoaches.com', prompt: 'select_account' },
        redirectTo: window.location.origin
      }
    });
    if (sErr) setError(sErr.message);
  }

  async function signOut() {
    setError(null);
    await supabase.auth.signOut();
  }

  return {
    status,
    user: session?.user || null,
    session,
    error,
    signIn,
    signOut
  };
}