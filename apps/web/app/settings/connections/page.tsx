"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { gatewayAuthorizationHeaders } from "@/lib/client-session";

type Connection = { connected: boolean; mailbox: { email: string } | null; mail_url: string };
type Email = { id: string; from: string; subject: string; snippet: string };
const LINK_STATE = "veltra-mail-link-state";

async function call<T>(method: string, path = "link", body?: object): Promise<T> {
  const response = await fetch(`/api/mail/${path}`, {
    method, cache: "no-store", headers: { ...await gatewayAuthorizationHeaders(), "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Could not connect to Veltra Mail.");
  return data as T;
}

export default function ConnectionsPage() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [emails, setEmails] = useState<Email[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const refresh = useCallback(async () => {
    try { setConnection(await call<Connection>("GET")); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load connections."); }
  }, []);
  useEffect(() => {
    const query = new URLSearchParams(location.search);
    const result = query.get("mail");
    if (result) {
      const expected = sessionStorage.getItem(LINK_STATE);
      sessionStorage.removeItem(LINK_STATE);
      if (!expected || query.get("state") !== expected) setError("This connection was started in another browser session. Check your connection below.");
      else if (result === "connected") setNotice("Veltra Mail is connected. Your standalone Mail account stays available.");
      else setError(result === "cancelled" ? "Connection cancelled. Your Mail account is unchanged." : result === "permissions" ? "Google mailbox permissions were not granted. Try again and allow the permissions needed by Veltra Mail." : "The connection could not finish. Please try again.");
      history.replaceState(null, "", "/settings/connections");
    }
    void refresh();
  }, [refresh]);

  async function act(action: "connect" | "disconnect" | "inbox") {
    setBusy(true); setError(""); setNotice("");
    try {
      if (action === "connect") {
        const browser = crypto.randomUUID();
        sessionStorage.setItem(LINK_STATE, browser);
        const { url } = await call<{ url: string }>("POST", "link", { browser });
        const target = new URL(url);
        if (target.protocol !== "https:" && target.hostname !== "localhost") throw new Error("Mail connection URL is invalid.");
        location.assign(url);
      } else if (action === "disconnect") {
        await call("DELETE"); setEmails(null);
        setNotice("Disconnected from Chat. You can still sign in to Veltra Mail and use your mailbox there.");
        await refresh();
      } else {
        setEmails((await call<{ emails: Email[] }>("GET", "inbox")).emails);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Please try again."); }
    finally { setBusy(false); }
  }

  return <main className="settings-page"><section className="settings-content">
    <Link href="/" className="back-link">← Back to workspace</Link>
    <h1>Workspace connections</h1>
    <article className="settings-card">
      <h2>Veltra Mail</h2>
      <p>Use Mail on its own, or connect it here with Google whenever you want. Choose the Google mailbox you want to use.</p>
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
      {connection && <p>{connection.connected ? `Connected · ${connection.mailbox?.email ?? "Mailbox not connected"}` : "Not connected to Chat"}</p>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        {connection?.connected ? <>
          <button className="button button-secondary" disabled={busy} onClick={() => void act("inbox")}>View recent mail</button>
          <button className="button button-secondary" disabled={busy} onClick={() => void act("disconnect")}>Disconnect from Chat</button>
        </> : <button className="button button-primary" disabled={busy || !connection} onClick={() => void act("connect")}>{busy ? "Connecting…" : "Connect with Google"}</button>}
        {connection && <a className="button button-secondary" href={connection.mail_url} target="_blank" rel="noreferrer">Open standalone Veltra Mail</a>}
      </div>
      <p>Disconnecting from Chat keeps your Mail account, mailbox connection and Mail access.</p>
    </article>
    {emails && <section className="settings-card"><h2>Recent mail</h2>{emails.length ? emails.map(email => <article key={email.id}><h3>{email.subject || "(No subject)"}</h3><p>{email.from}</p><p>{email.snippet}</p></article>) : <p>No recent messages.</p>}</section>}
  </section></main>;
}
