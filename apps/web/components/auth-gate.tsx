"use client";

import { FormEvent, ReactNode, useEffect, useState } from "react";
import { browserSupabase } from "@/lib/supabase";

export default function AuthGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const supabase = browserSupabase();
    if (!supabase) {
      setError("Sign-in is not configured. Set the Supabase URL and public key on the web server.");
      setReady(true);
      return;
    }
    let active = true;
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      setSignedIn(Boolean(data.session));
      if (error) setError(error.message);
      setReady(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) { setSignedIn(Boolean(session)); setReady(true); }
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, []);

  async function signIn(event: FormEvent) {
    event.preventDefault();
    const supabase = browserSupabase();
    if (!supabase) return;
    setBusy(true);
    setError("");
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
      setPassword("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not sign in. Please try again.");
    } finally { setBusy(false); }
  }

  if (!ready) return <main className="auth-page"><p role="status">Opening your workspace…</p></main>;
  if (signedIn) return <>{children}</>;
  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={signIn}>
        <span className="eyebrow">VELTRA WORKSPACE</span>
        <h1>Welcome back.</h1>
        <p>Sign in to your Veltra account to start chatting.</p>
        <label htmlFor="login-email">Email</label>
        <input id="login-email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required />
        <label htmlFor="login-password">Password</label>
        <input id="login-password" type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={showPassword} onChange={(event) => setShowPassword(event.target.checked)} aria-controls="login-password" style={{ width: "auto" }} />
          Show password
        </label>
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={busy || !browserSupabase()}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </main>
  );
}
