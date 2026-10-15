"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabaseBrowserClient } from "@/lib/supabase";

type GateState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "signed-in"; session: Session }
  | { status: "error"; message: string };

export default function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>({ status: "loading" });

  useEffect(() => {
    let supabase;
    try {
      supabase = supabaseBrowserClient();
    } catch (error) {
      setState({ status: "error", message: error instanceof Error ? error.message : "Sign-in is unavailable." });
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      setState(data.session ? { status: "signed-in", session: data.session } : { status: "signed-out" });
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setState(session ? { status: "signed-in", session } : { status: "signed-out" });
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  if (state.status === "loading") {
    return <div className="auth-screen" aria-busy="true" />;
  }
  if (state.status === "error") {
    return <SignInMessage message={state.message} />;
  }
  if (state.status === "signed-out") {
    return <SignIn />;
  }
  return <>{children}</>;
}

function SignInMessage({ message }: { message: string }) {
  return (
    <main className="auth-screen">
      <section className="auth-card">
        <h1>Veltra Model 1</h1>
        <p role="alert">{message}</p>
      </section>
    </main>
  );
}

function SignIn() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function sendMagicLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    const { error: otpError } = await supabaseBrowserClient().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });
    setBusy(false);
    if (otpError) {
      setError(otpError.message);
      return;
    }
    setNotice("Check your email for a sign-in link.");
  }

  async function signInWithGoogle() {
    setError("");
    const { error: oauthError } = await supabaseBrowserClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (oauthError) setError(oauthError.message);
  }

  return (
    <main className="auth-screen">
      <section className="auth-card">
        <h1>Sign in to Veltra Model 1</h1>
        <button type="button" className="auth-google" onClick={signInWithGoogle}>
          Continue with Google
        </button>
        <div className="auth-divider">or</div>
        <form onSubmit={sendMagicLink}>
          <label htmlFor="auth-email">Email</label>
          <input
            id="auth-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <button type="submit" disabled={busy || !email.trim()}>
            {busy ? "Sending…" : "Email me a sign-in link"}
          </button>
        </form>
        {notice && <p role="status">{notice}</p>}
        {error && <p role="alert">{error}</p>}
      </section>
    </main>
  );
}
