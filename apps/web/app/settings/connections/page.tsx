"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowUpRight, Check, Mail, Plug, ShieldCheck } from "lucide-react";
import { gatewayAuthorizationHeaders } from "@/lib/client-session";

type Connection = { connected: boolean; mailbox: { email: string } | null; mail_url: string };
const LINK_STATE = "veltra-mail-link-state";
async function call<T>(method: string, body?: object): Promise<T> {
  const response = await fetch("/api/mail/link", { method, cache: "no-store", headers: { ...await gatewayAuthorizationHeaders(), "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Could not connect to Veltra Mail.");
  return data as T;
}
export default function ConnectionsPage() {
  const [connection, setConnection] = useState<Connection | null>(null);
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
      if (!expected || query.get("state") !== expected) setError("Check your connection below. This attempt started in another browser session.");
      else if (result === "connected") setNotice("Google is connected. Open Veltra Mail below to use your workspace in the canvas.");
      else setError(result === "cancelled" ? "Google connection cancelled." : "Google connection could not finish. Try again and grant the requested Mail permissions.");
      history.replaceState(null, "", "/settings/connections");
    }
    void refresh();
  }, [refresh]);
  async function connect(disconnect = false) {
    setBusy(true); setError(""); setNotice("");
    try {
      if (disconnect) { await call("DELETE"); await refresh(); setNotice("Google disconnected from Chat. Standalone Veltra Mail remains available."); }
      else {
        const browser = crypto.randomUUID(); sessionStorage.setItem(LINK_STATE, browser);
        const { url } = await call<{ url: string }>("POST", { browser });
        if (new URL(url).protocol !== "https:") throw new Error("Mail connection URL is invalid.");
        location.assign(url);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Please try again."); }
    finally { setBusy(false); }
  }
  return <main className="connections-page">
    <header className="connections-header"><Link href="/" className="connections-back"><ArrowLeft size={16}/> Back to Chat</Link><Link href="/" className="connections-brand"><img src="/veltra-logo.png" alt=""/> Veltra</Link></header>
    <section className="connections-body">
      <div className="connections-title"><div><h1>Your workspace, connected.</h1><p>Connect Google once. Open Veltra Mail in your canvas and keep Chat beside you.</p></div><Plug size={30}/></div>
      {notice && <p className="connections-notice" role="status">{notice}</p>}{error && <p className="connections-error" role="alert">{error}</p>}
      <section className="connected-apps" aria-labelledby="apps-title"><div className="connections-section-heading"><h2 id="apps-title">Your apps</h2><span>{connection?.connected ? "1 connected" : "Connect Google to get started"}</span></div>
        <article className={`mail-app-card ${connection?.connected ? "is-connected" : ""}`}>
          <div className="mail-app-icon"><Mail size={30}/></div><div className="mail-app-copy"><h3>Veltra Mail</h3><p>Your full email workspace, inside Veltra.</p><span>Inbox · Approvals · Contacts · Sender folders · Business settings</span></div>
          {connection?.connected ? <Link className="open-mail-button" href="/?canvas=mail">Open Veltra Mail <ArrowUpRight size={18}/></Link> : <a className="mail-connect-hint" href="#google-connector">Connect Google below <ArrowLeft size={15}/></a>}
          <div className="mail-app-footer"><span className={`connection-status ${connection?.connected ? "connected" : ""}`}><i/>{connection?.connected ? connection.mailbox?.email ?? "Google connected" : "Google connection required"}</span>{connection && <a href={connection.mail_url} target="_blank" rel="noreferrer">Open standalone Mail <ArrowUpRight size={13}/></a>}</div>
        </article>
      </section>
      <section className="google-connector" id="google-connector" aria-labelledby="google-title"><div className="google-icon" aria-hidden="true">G</div><div className="google-copy"><h2 id="google-title">Google Workspace</h2><p>{connection?.connected ? `Connected as ${connection.mailbox?.email ?? "your Google account"}` : "Turn on Google to bring your Gmail workspace into Veltra Mail."}</p><span><ShieldCheck size={14}/> You choose the account and approve access.</span></div><button className={`google-connect-button ${connection?.connected ? "connected" : ""}`} disabled={busy || !connection} onClick={() => void connect(Boolean(connection?.connected))}>{busy ? "Please wait…" : connection?.connected ? <><Check size={17}/> Connected · Disconnect</> : "Connect Google"}</button></section>
      <p className="connections-footnote">Veltra Mail also works on its own. Disconnecting here keeps your standalone Mail account and mailbox connection.</p>
    </section>
  </main>;
}
