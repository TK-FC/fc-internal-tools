import React from 'react';
import { Zap, LogIn, ShieldAlert, LogOut } from 'lucide-react';

// Match the theme constants from App.jsx so this looks like the rest of the app.
const YELLOW = '#FFD23F';
const BG = '#0F0F0F';
const PANEL = '#1A1A1A';
const BORDER = '#2A2A2A';
const TEXT = '#F5F5F5';
const TEXT_DIM = '#888';
const TEXT_FAINT = '#5A5A5A';

// ============================================================
// LoginScreen — shown when status === 'signed-out'
// ============================================================
export function LoginScreen({ onSignIn, error }) {
  return (
    <Shell>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 48, height: 48, background: YELLOW, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: BG, margin: '0 auto 18px' }}>
          <Zap size={26} strokeWidth={2.5} />
        </div>
        <div style={{ fontFamily: '"Space Grotesk", sans-serif', fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 4 }}>Foodie Coaches</div>
        <div style={{ fontSize: 10, color: YELLOW, textTransform: 'uppercase', letterSpacing: '0.18em', fontWeight: 600, marginBottom: 28 }}>AI Project Dashboard</div>

        <div style={{ fontSize: 13, color: TEXT_DIM, lineHeight: 1.55, marginBottom: 24 }}>
          Internal tool. Sign in with your<br />@foodiecoaches.com Google account.
        </div>

        <button onClick={onSignIn} style={{ background: YELLOW, color: BG, border: 'none', padding: '12px 22px', borderRadius: 5, fontWeight: 600, fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: 'inherit' }}>
          <LogIn size={14} strokeWidth={2.5} /> Sign in with Google
        </button>

        {error && (
          <div style={{ marginTop: 18, padding: '8px 12px', background: 'rgba(255, 107, 107, 0.12)', border: '1px solid #FF6B6B', borderRadius: 4, color: '#FF6B6B', fontSize: 12 }}>
            {error}
          </div>
        )}
      </div>
    </Shell>
  );
}

// ============================================================
// PendingAccessScreen — shown when status === 'signed-in-pending'
// Signed in OK with Google, but email isn't on the allowlist (or is inactive).
// ============================================================
export function PendingAccessScreen({ email, onSignOut }) {
  return (
    <Shell>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 48, height: 48, background: 'rgba(255, 181, 71, 0.15)', border: '1px solid #FFB547', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFB547', margin: '0 auto 18px' }}>
          <ShieldAlert size={24} strokeWidth={2.2} />
        </div>
        <div style={{ fontFamily: '"Space Grotesk", sans-serif', fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 8 }}>Access pending</div>

        <div style={{ fontSize: 13, color: TEXT_DIM, lineHeight: 1.6, marginBottom: 6 }}>
          You signed in as
        </div>
        <div style={{ fontSize: 13, color: TEXT, fontWeight: 600, marginBottom: 20, wordBreak: 'break-all' }}>
          {email}
        </div>
        <div style={{ fontSize: 12.5, color: TEXT_DIM, lineHeight: 1.6, marginBottom: 24 }}>
          That account isn't on the dashboard allowlist yet.<br />
          Ask Sam to add you, then sign in again.
        </div>

        <button onClick={onSignOut} style={{ background: 'transparent', border: `1px solid ${BORDER}`, color: TEXT, padding: '10px 18px', borderRadius: 5, fontWeight: 600, fontSize: 12, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: 'inherit' }}>
          <LogOut size={13} /> Sign out
        </button>
      </div>
    </Shell>
  );
}

// ============================================================
// Shared shell so both screens have the same centred-card layout
// ============================================================
function Shell({ children }) {
  return (
    <div style={{ minHeight: '100vh', background: BG, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, fontFamily: '"Inter", -apple-system, sans-serif', color: TEXT }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&display=swap');`}</style>
      <div style={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '40px 36px', maxWidth: 380, width: '100%', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, transparent, ${YELLOW}, transparent)` }} />
        {children}
      </div>
    </div>
  );
}