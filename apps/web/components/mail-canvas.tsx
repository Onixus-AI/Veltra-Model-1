"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { gatewayAuthorizationHeaders } from "@/lib/client-session";

export default function MailCanvas({ onClose }: { onClose: () => void }) {
  const [source, setSource] = useState("");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    const launch = async () => {
      try {
        const response = await fetch("/api/mail/launch", { method: "POST", headers: await gatewayAuthorizationHeaders() });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Could not open Onixus Mail.");
        if (active) { setSource(data.url); setError(""); }
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "Could not open Mail."); }
    };
    void launch();
    const timer = setInterval(() => void launch(), 180_000);
    return () => { active = false; clearInterval(timer); };
  }, [attempt]);
  return <section className="mail-canvas">
    <header><div><img src="/brands/veltra-mail.svg" width={24} height={24} alt="Onixus Mail logo" style={{ objectFit: "contain" }} /><span className="mail-status-dot" /> <strong>Onixus Mail</strong><span className="mail-canvas-caption">Your Mail workspace</span></div><div><Link href="/settings/connections">Connections</Link><button onClick={() => { setSource(""); setAttempt(value => value+1); }}>Reload Mail</button><button onClick={onClose}>Back to canvas</button></div></header>
    {error && source && <p className="mail-canvas-refresh-error" role="alert">{error} Your open Mail workspace is preserved. Use Reload Mail to reconnect.</p>}
    {error && !source ? <div className="mail-canvas-state" role="alert"><h2>Open your Mail workspace</h2><p>{error}</p><Link href="/settings/connections">Manage Google connection</Link><button onClick={() => setAttempt(value => value+1)}>Try again</button></div> : source ? <iframe title="Onixus Mail workspace" src={source} sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals allow-top-navigation-by-user-activation" /> : <div className="mail-canvas-state" role="status">Opening Onixus Mail…</div>}
  </section>;
}
