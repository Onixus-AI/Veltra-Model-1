'use client';

import { useEffect, useState } from 'react';
import { browserSupabase } from '@/lib/supabase';

const ALLOWED_SOURCE = new Set(['https://www.onixus.xyz', 'https://onixus.xyz']);

export default function OnixusHandoff() {
  const [message, setMessage] = useState('Connecting your verified Onixus account…');
  const [needsExistingSignIn, setNeedsExistingSignIn] = useState(false);
  useEffect(() => {
    const opener = window.opener;
    const nonce = new URLSearchParams(window.location.search).get('nonce');
    const sourceOrigin = new URLSearchParams(window.location.search).get('source_origin');
    if (!opener || !nonce || !/^[0-9a-f-]{36}$/i.test(nonce) || !sourceOrigin || !ALLOWED_SOURCE.has(sourceOrigin)) {
      setMessage('Open Workspace from your Onixus account.');
      return;
    }
    let started = false;
    const receive = async (event: MessageEvent) => {
      if (started || event.source !== opener || event.origin !== sourceOrigin
        || event.data?.type !== 'onixus.workspace.session' || event.data?.nonce !== nonce
        || typeof event.data.access_token !== 'string') return;
      started = true;
      try {
        const supabase = browserSupabase();
        if (!supabase) throw Error('Workspace sign-in is not configured.');
        const { data: sessionData } = await supabase.auth.getSession();
        const workspaceToken = sessionData.session?.access_token;
        const response = await fetch('/api/onixus/handoff', {
          method: 'POST', headers: {
            Authorization: `Bearer ${event.data.access_token}`,
            ...(workspaceToken ? { 'X-Workspace-Authorization': `Bearer ${workspaceToken}` } : {}),
          },
          cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(20000),
        });
        const result = await response.json();
        if (!response.ok) {
          if (response.status === 409 && !workspaceToken && result.error?.includes('already uses this email')) {
            setNeedsExistingSignIn(true);
            throw Error('An existing Workspace account uses this email. Sign in to Workspace at this address, then reopen it from Onixus to link both verified accounts.');
          }
          throw Error(result.error || 'Workspace could not open.');
        }
        const { data, error } = await supabase.auth.verifyOtp({ token_hash: result.token_hash, type: 'email' });
        if (error || !data.user) throw Error('Workspace could not verify your account.');
        window.location.replace('/workspace?workspace=' + encodeURIComponent(result.workspace));
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Workspace could not open.');
      }
    };
    window.addEventListener('message', receive);
    opener.postMessage({ type: 'onixus.workspace.ready', nonce }, sourceOrigin);
    return () => window.removeEventListener('message', receive);
  }, []);
  return <main className="auth-page"><div className="auth-card"><img className="auth-logo" src="/veltra-logo.png" alt="Onixus Workspace"/><h1>Opening Workspace</h1><p role="status">{message}</p>{needsExistingSignIn && <a href="/" target="_blank" rel="noopener noreferrer">Sign in to existing Workspace</a>}<a href="https://www.onixus.xyz/workspace">Return to Onixus</a></div></main>;
}
