'use client';

import { useEffect, useState } from 'react';
import { browserSupabase } from '@/lib/supabase';
import { ONIXUS_ORIGIN, onixusSignInUrl, readOnixusReturn } from '@/lib/onixus-signin';

const ALLOWED_SOURCE = new Set(['https://www.onixus.xyz', 'https://onixus.xyz']);

/** Exchanges a verified Onixus session for this person's Onixus Workspace session. */
async function openWorkspace(onixusToken: string): Promise<{ needsExistingSignIn: boolean; error?: string }> {
  const supabase = browserSupabase();
  if (!supabase) return { needsExistingSignIn: false, error: 'Workspace sign-in is not configured.' };
  const { data: sessionData } = await supabase.auth.getSession();
  const workspaceToken = sessionData.session?.access_token;
  const response = await fetch('/api/onixus/handoff', {
    method: 'POST', headers: {
      Authorization: `Bearer ${onixusToken}`,
      ...(workspaceToken ? { 'X-Workspace-Authorization': `Bearer ${workspaceToken}` } : {}),
    },
    cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(20000),
  });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 409 && !workspaceToken && result.error?.includes('already uses this email')) {
      return { needsExistingSignIn: true, error: 'An older Workspace account uses this email. Contact Onixus support to move it onto your Onixus login.' };
    }
    return { needsExistingSignIn: false, error: result.error || 'Workspace could not open.' };
  }
  const { data, error } = await supabase.auth.verifyOtp({ token_hash: result.token_hash, type: 'email' });
  if (error || !data.user) return { needsExistingSignIn: false, error: 'Workspace could not verify your account.' };
  window.location.replace('/workspace?workspace=' + encodeURIComponent(result.workspace));
  return { needsExistingSignIn: false };
}

export default function OnixusHandoff() {
  const [message, setMessage] = useState('Signing you in with Onixus…');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    // Return from the Onixus login (Continue with Onixus).
    const returned = readOnixusReturn(window.location.hash, window.sessionStorage);
    if (returned) {
      window.history.replaceState(null, '', window.location.pathname);
      if ('error' in returned) { setMessage(returned.error); setFailed(true); return; }
      void openWorkspace(returned.token)
        .then((result) => { if (result.error) { setMessage(result.error); setFailed(true); } })
        .catch(() => { setMessage('Workspace could not open.'); setFailed(true); });
      return;
    }

    // "Open Workspace" button inside onixus.xyz (popup).
    const opener = window.opener;
    const nonce = new URLSearchParams(window.location.search).get('nonce');
    const sourceOrigin = new URLSearchParams(window.location.search).get('source_origin');
    if (!opener || !nonce || !/^[0-9a-f-]{36}$/i.test(nonce) || !sourceOrigin || !ALLOWED_SOURCE.has(sourceOrigin)) {
      setMessage('Sign in to Onixus Workspace with your Onixus account.');
      setFailed(true);
      return;
    }
    let started = false;
    const receive = async (event: MessageEvent) => {
      if (started || event.source !== opener || event.origin !== sourceOrigin
        || event.data?.type !== 'onixus.workspace.session' || event.data?.nonce !== nonce
        || typeof event.data.access_token !== 'string') return;
      started = true;
      try {
        const result = await openWorkspace(event.data.access_token);
        if (result.error) { setMessage(result.error); setFailed(true); }
      } catch {
        setMessage('Workspace could not open.'); setFailed(true);
      }
    };
    window.addEventListener('message', receive);
    opener.postMessage({ type: 'onixus.workspace.ready', nonce }, sourceOrigin);
    return () => window.removeEventListener('message', receive);
  }, []);

  function tryAgain() {
    window.location.assign(onixusSignInUrl(window.location.origin, window.sessionStorage));
  }

  return <main className="auth-page"><div className="auth-card"><img className="auth-logo" src="/veltra-logo.png" alt="Onixus Workspace"/><h1>Opening Workspace</h1><p role="status">{message}</p>{failed && <button type="button" onClick={tryAgain}>Continue with Onixus</button>}<a href={`${ONIXUS_ORIGIN}/workspace`}>Go to Onixus</a></div></main>;
}
