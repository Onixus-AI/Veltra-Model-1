"use client";

import { FormEvent, ReactNode, useEffect, useState } from "react";
import { browserSupabase } from "@/lib/supabase";

export default function AuthGate({ children }: { children: ReactNode }) {
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [resetMode, setResetMode] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const recoveryPending = window.location.hash.includes("type=recovery") || sessionStorage.getItem("veltra-password-recovery") === "1";
    setRecovering(recoveryPending);
    const supabase = browserSupabase();
    if (!supabase) {
      setError("Sign-in is not configured. Set the Supabase URL and public key on the web server.");
      setReady(true);
      return;
    }
    let active = true;
    void fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "" } })
      .then(response => response.ok ? response.json() : null)
      .then(settings => { if (active) setGoogleEnabled(settings?.external?.google === true); })
      .catch(() => {});
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      setSignedIn(Boolean(data.session));
      if (error) setError(error.message);
      setReady(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (active && event === "PASSWORD_RECOVERY") {
        sessionStorage.setItem("veltra-password-recovery", "1");
        setRecovering(true);
        setPassword("");
        setError("");
      }
      if (active) { setSignedIn(Boolean(session)); setReady(true); }
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, []);

  async function signInWithGoogle() {
    const supabase = browserSupabase(); if (!supabase) return;
    setBusy(true); setError("");
    const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin + "/", queryParams: { prompt: "select_account" } } });
    if (error) { setError(error.message); setBusy(false); }
  }

  async function signIn(event: FormEvent) {
    event.preventDefault();
    const supabase = browserSupabase();
    if (!supabase) return;
    setBusy(true);
    setError("");
    try {
      if (recovering) {
        if (password !== confirmPassword) throw new Error("Passwords do not match.");
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        sessionStorage.removeItem("veltra-password-recovery");
        setRecovering(false);
        setConfirmPassword("");
      } else if (resetMode) {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin + "/" });
        if (error) throw error;
        setNotice("Reset link requested. Check your email and spam folder, then open the link to choose a new password.");
        return;
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      }
      setPassword("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not sign in. Please try again.");
    } finally { setBusy(false); }
  }

  if (!ready) return <main className="auth-page"><p role="status">Opening your workspace…</p></main>;
  if (signedIn && !recovering) return <>{children}</>;
  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={signIn}>
        <img className="auth-logo" src="/veltra-logo.png" alt="Veltra" />
        <span className="eyebrow">VELTRA WORKSPACE</span>
        <h1>{recovering ? "Choose a new password." : resetMode ? "Reset your password." : "Welcome back."}</h1>
        <p>{recovering ? "Enter and confirm your new Veltra password." : resetMode ? "We’ll email you a link to reset your Veltra password." : "Sign in to your Veltra account to start chatting."}</p>
        {!recovering && <>
        <label htmlFor="login-email">Email</label>
        <input id="login-email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </>}
        {(!resetMode || recovering) && <>
        <label htmlFor="login-password">{recovering ? "New password" : "Password"}</label>
        <input id="login-password" type={showPassword ? "text" : "password"} minLength={recovering ? 8 : undefined} autoComplete={recovering ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} required />
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={showPassword} onChange={(event) => setShowPassword(event.target.checked)} aria-controls="login-password" style={{ width: "auto" }} />
          Show password
        </label>
        {recovering && <>
          <label htmlFor="confirm-password">Confirm new password</label>
          <input id="confirm-password" type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={8} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
        </>}
        </>}
        {notice && <p role="status">{notice}</p>}
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={busy || !browserSupabase()}>{busy ? "Please wait…" : recovering ? "Save new password" : resetMode ? "Send reset link" : "Sign in"}</button>
        {!recovering && !resetMode && googleEnabled && <button type="button" disabled={busy} onClick={() => void signInWithGoogle()}>Continue with Google</button>}
        {!recovering && <button type="button" disabled={busy} onClick={() => { setResetMode(!resetMode); setError(""); setNotice(""); setPassword(""); }}>{resetMode ? "Back to sign in" : "Forgot password?"}</button>}
      </form>
    </main>
  );
}
