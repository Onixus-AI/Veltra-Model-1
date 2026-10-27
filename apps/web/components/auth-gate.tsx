"use client";

import { FormEvent, ReactNode, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { browserSupabase } from "@/lib/supabase";

export default function AuthGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const publicPage = ["/eula", "/privacy", "/docs", "/support", "/revenue/paid", "/revenue/preview"].includes(pathname);
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
    if (publicPage) return;
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
  }, [publicPage]);

  async function signInWithGoogle() {
    const supabase = browserSupabase(); if (!supabase) return;
    setBusy(true); setError("");
    const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin + (pathname === "/workspace/join" ? window.location.pathname + window.location.search : "/"), queryParams: { prompt: "select_account" } } });
    if (error) { setError(error.message); setBusy(false); }
  }

  async function invitationSignIn() {
    const supabase = browserSupabase(); if (process.env.NEXT_PUBLIC_CLIENT_EMAIL_SIGNIN_ENABLED !== "true") { setError("Use Continue with Google with your invited email. Email-link sign-in is not configured yet."); return; }
    if (!supabase || !email.trim()) { setError("Enter the email that received the invitation."); return; }
    setBusy(true); setError("");
    try {
      const {error} = await supabase.auth.signInWithOtp({email: email.trim(), options: {emailRedirectTo: window.location.origin + window.location.pathname + window.location.search}});
      if (error) throw error;
      setNotice("Check your email for a sign-in link, then return to accept the invitation. No password is needed.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not request sign-in link."); } finally { setBusy(false); }
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

  if (publicPage) return <>{children}</>;
  if (!ready) return <main className="auth-page"><p role="status">Opening your workspace…</p></main>;
  if (signedIn && !recovering) return <>{children}</>;
  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={signIn}>
        <img className="auth-logo" src="/veltra-logo.png" alt="Onixus Workspace" />
        <span className="eyebrow">ONIXUS WORKSPACE</span>
        <h1>{recovering ? "Choose a new password." : resetMode ? "Reset your password." : "Welcome back."}</h1>
        <p>{recovering ? "Enter and confirm your new Onixus Workspace password." : resetMode ? "We’ll email you a link to reset your Onixus Workspace password." : "Sign in once to open Chat, Mail and CRM."}</p>
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
        {pathname === "/workspace/join" && process.env.NEXT_PUBLIC_CLIENT_EMAIL_SIGNIN_ENABLED === "true" && !recovering && !resetMode && <button type="button" disabled={busy} onClick={() => void invitationSignIn()}>Email me a sign-in link</button>}
        {pathname === "/workspace/join" && !recovering && !resetMode && process.env.NEXT_PUBLIC_CLIENT_EMAIL_SIGNIN_ENABLED !== "true" && <p>{googleEnabled ? "Use Continue with Google with the email your agency invited. You do not need an existing Workspace password." : "Client sign-in is not configured yet. Ask your agency to enable a verified sign-in provider."}</p>}
        {!recovering && !resetMode && googleEnabled && <button type="button" disabled={busy} onClick={() => void signInWithGoogle()}>Continue with Google</button>}
        {!recovering && <button type="button" disabled={busy} onClick={() => { setResetMode(!resetMode); setError(""); setNotice(""); setPassword(""); }}>{resetMode ? "Back to sign in" : "Forgot password?"}</button>}
        <nav className="auth-legal" aria-label="Legal and help"><Link href="/eula">Terms</Link><Link href="/privacy">Privacy</Link><Link href="/docs">Docs</Link><Link href="/support">Support</Link></nav>
      </form>
    </main>
  );
}
