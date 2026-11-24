"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowUpRight, Check, CircleAlert, Loader2, RefreshCw, Search, X } from "lucide-react";
import ToolLogo from "@/components/tool-logo";
import { ConfirmDialog } from "@/components/ui";
import { gatewayAuthorizationHeaders } from "@/lib/client-session";
import { connectionRequest, type Provider } from "@/lib/connections-client";
import { crmConnection, setCrmConnection } from "@/lib/crm-connection";
import { useWorkspaceBusiness } from "@/lib/workspace-business";
import { workspaceHref } from "@/lib/workspace-navigation";
import {
  CONNECTORS, GROUP_ORDER, crmStatus, developerStatus, gmailStatus, onyxMailStatus, googleStatus, includedStatus,
  shopifyStatus, signalStatus, zeeStatus, summarize, type Connector, type ConnectorId, type ConnectorStatus,
} from "@/lib/connector-status";

type Statuses = Partial<Record<ConnectorId, ConnectorStatus>>;
type Filter = "all" | "connected" | "available";
type Resource = { id: string; name: string };
const DEV: Provider[] = ["github", "vercel", "supabase", "n8n"];
const MAIL_STATE = "veltra-mail-link-state";
const ONYX_MAIL_STATE = "onixus-onyx-mail-link-state";

async function getJson(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(path, { ...init, cache: "no-store", headers: { ...(await gatewayAuthorizationHeaders()), "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "This service did not answer.");
  return data;
}
const settle = async <T,>(work: () => Promise<T>) => { try { return await work(); } catch { return null; } };
const https = (url: unknown) => { if (typeof url !== "string" || new URL(url).protocol !== "https:") throw new Error("The sign-in link was not valid."); return url; };

export default function ConnectionsHub() {
  const business = useWorkspaceBusiness() ?? "";
  const [statuses, setStatuses] = useState<Statuses>({});
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<ConnectorId | "">("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [n8nUrl, setN8nUrl] = useState("");
  const [picker, setPicker] = useState<{ id: Provider; items: Resource[]; chosen: string } | null>(null);
  const [pendingDisconnect, setPendingDisconnect] = useState<Connector | null>(null);

  const refresh = useCallback(async () => {
    setStatuses({});
    const [mail, onyxMail, drive, calendar, dev, included, crm, shopify, signal, bee, zee] = await Promise.all([
      settle(() => getJson("/api/mail/link")),
      settle(() => getJson("/api/mail/onyx-link")),
      settle(() => getJson("/api/google/status")),
      settle(() => getJson("/api/google-calendar/status")),
      settle(() => getJson("/api/connections/status")),
      settle(() => getJson("/api/integrations/status")),
      settle(async () => (await crmConnection()) as unknown as Record<string, unknown>),
      settle(() => getJson("/api/mail/shopify")),
      settle(() => getJson("/api/workspace/signal")),
      settle(() => getJson("/api/bee/status")),
      settle(() => getJson("/api/zee/status?workspace=" + encodeURIComponent(business))),
    ]);
    const next: Statuses = {
      gmail: gmailStatus(mail), mail: onyxMailStatus(onyxMail), drive: googleStatus(drive), calendar: googleStatus(calendar),
      firecrawl: includedStatus(included, "firecrawl"), crm: crmStatus(crm), shopify: shopifyStatus(shopify),
      signal: signalStatus(signal, business), zee: zeeStatus(zee), bee: bee && typeof bee.connected === "boolean" ? { state: bee.connected ? "connected" : "available" } : { state: "unavailable" },
    };
    for (const p of DEV) next[p] = developerStatus(dev?.connections, p);
    setStatuses(next);
  }, [business]);

  useEffect(() => {
    // Sign-ins that return here (Gmail, developer tools, Bee) report their result in the address.
    const q = new URLSearchParams(location.search);
    const check = (key: string, value: string | null) => { const expected = sessionStorage.getItem(key); sessionStorage.removeItem(key); return !!expected && expected === value; };
    const mail = q.get("mail"), dev = q.get("developer"), bee = q.get("bee");
    if (mail) {
      const onyx = sessionStorage.getItem(ONYX_MAIL_STATE) !== null;
      if (!check(onyx ? ONYX_MAIL_STATE : MAIL_STATE, q.get("state"))) setError(`That sign-in started in another tab. Check ${onyx ? "Onixus Mail + Onyx" : "Gmail"} below.`);
      else if (mail === "connected") setNotice(`${onyx ? "Onixus Mail is linked to Onyx" : "Gmail is connected"}.`);
      else setError(mail === "cancelled" ? "Mail sign-in was cancelled." : "Mail could not finish connecting. Try again.");
    }
    if (dev) { const p = q.get("provider") ?? ""; if (!check(`veltra-connect-${p}`, q.get("state"))) setError("That sign-in expired. Check its status below."); else if (dev === "connected") setNotice("Connected. Choose what Onyx can use from the card below."); else setError(dev === "cancelled" ? "Connection cancelled." : "That connection did not finish. Try again."); }
    if (bee) { if (!check("veltra-bee-state", q.get("state"))) setError("That Bee sign-in expired. Check Bee's status below."); else if (bee === "connected") setNotice("Bee is connected."); else setError(bee === "cancelled" ? "Bee sign-in was cancelled." : "Bee could not connect. Try again."); }
    if (mail || dev || bee) history.replaceState(null, "", "/settings/connections" + (business ? "?workspace=" + encodeURIComponent(business) : ""));
    void refresh();
  }, [refresh, business]);

  async function run(id: ConnectorId, work: () => Promise<void>) {
    setBusy(id); setError(""); setNotice("");
    try { await work(); } catch (e) { setError(e instanceof Error ? e.message : "That did not work. Try again."); } finally { setBusy(""); }
  }
  const signIn = async (key: string, start: (browser: string) => Promise<unknown>) => {
    const browser = crypto.randomUUID(); sessionStorage.setItem(key, browser);
    location.assign(https(await start(browser)));
  };

  function connect(c: Connector) {
    return run(c.id, async () => {
      if (c.id === "gmail") return signIn(MAIL_STATE, async (browser) => (await getJson("/api/mail/link", { method: "POST", body: JSON.stringify({ browser }) })).url);
      if (c.id === "mail") return signIn(ONYX_MAIL_STATE, async (browser) => (await getJson("/api/mail/onyx-link", { method: "POST", body: JSON.stringify({ browser }) })).url);
      if (c.id === "drive") return signIn("onixus-google-state", async (browser) => (await getJson("/api/google/start", { method: "POST", body: JSON.stringify({ browser }) })).url);
      if (c.id === "calendar") {
        if (!business) throw new Error("Choose a business first. Calendar connects to one business at a time.");
        return signIn("onixus-google-calendar-state", async (browser) => (await getJson("/api/google-calendar/start", { method: "POST", body: JSON.stringify({ browser, workspace_id: business }) })).url);
      }
      if (c.id === "bee") return signIn("veltra-bee-state", async (browser) => (await getJson("/api/bee/start", { method: "POST", body: JSON.stringify({ browser }) })).url);
      if ((DEV as string[]).includes(c.id)) {
        const p = c.id as Provider;
        if (p === "n8n" && !n8nUrl.trim()) throw new Error("Enter your n8n address first, for example https://yourname.app.n8n.cloud");
        return signIn(`veltra-connect-${p}`, async (browser) => (await connectionRequest<{ url: string }>(`${p}/start`, "POST", { browser, ...(p === "n8n" ? { instance: n8nUrl.trim() } : {}) })).url);
      }
      if (c.id === "crm") { await setCrmConnection(true); setNotice("Onixus CRM is connected."); return refresh(); }
      if (c.id === "shopify") { location.assign("/?canvas=shopify"); return; }
      if (c.id === "zee") { window.open("https://zeevents.xyz", "_blank", "noopener"); setNotice("Sign up or sign in on Zee with this same email, then choose Check again."); return; }
      if (c.id === "signal") { location.assign("/crm?view=Connections" + (business ? "&workspace=" + encodeURIComponent(business) : "")); return; }
    });
  }

  function disconnect(c: Connector) {
    return run(c.id, async () => {
      if (c.id === "gmail") await getJson("/api/mail/link", { method: "DELETE" });
      else if (c.id === "mail") await getJson("/api/mail/onyx-link", { method: "DELETE" });
      else if (c.id === "drive") await getJson("/api/google/disconnect", { method: "DELETE" });
      else if (c.id === "calendar") await getJson("/api/google-calendar/disconnect", { method: "DELETE" });
      else if (c.id === "bee") await getJson("/api/bee/status", { method: "DELETE" });
      else if (c.id === "crm") await setCrmConnection(false);
      else if ((DEV as string[]).includes(c.id)) await connectionRequest(c.id, "DELETE");
      setNotice(`${c.name} disconnected. Your data in ${c.name} is untouched.`);
      await refresh();
    });
  }

  function choose(p: Provider) {
    return run(p, async () => {
      const data = await connectionRequest<{ resources: Resource[] }>(`${p}/resources`);
      if (!data.resources.length) throw new Error("Nothing was found in that account to choose from.");
      setPicker({ id: p, items: data.resources, chosen: data.resources[0].id });
    });
  }
  function saveChoice() {
    if (!picker) return;
    return run(picker.id, async () => { await connectionRequest(`${picker.id}/select`, "POST", { id: picker.chosen }); setPicker(null); setNotice("Saved. Onyx will use that from now on."); await refresh(); });
  }

  function manageHref(c: Connector): string | null {
    if (c.id === "gmail") return workspaceHref("mail", business);
    if (c.id === "mail") return workspaceHref("mail", business);
    if (c.id === "drive") return workspaceHref("files", business);
    if (c.id === "calendar") return "/settings/calendar" + (business ? "?workspace=" + encodeURIComponent(business) : "");
    if (c.id === "crm") return workspaceHref("crm", business);
    if (c.id === "shopify") return "/?canvas=shopify";
    if (c.id === "signal") return workspaceHref("signal", business);
    if (c.id === "zee") return workspaceHref("zee", business);
    if ((DEV as string[]).includes(c.id)) return `/?canvas=code&tool=${c.id}`;
    return null;
  }

  const summary = summarize(statuses);
  const visible = useMemo(() => CONNECTORS.filter((c) => {
    const state = statuses[c.id]?.state ?? "checking";
    const text = `${c.name} ${c.description} ${c.group}`.toLowerCase();
    return text.includes(query.trim().toLowerCase()) && (filter === "all" || (filter === "connected" ? state === "connected" : state !== "connected"));
  }), [statuses, filter, query]);

  return <main className="cx-page">
    <header className="cx-header">
      <Link href={workspaceHref("overview", business)} className="cx-back"><ArrowLeft size={16} />Workspace</Link>
      <div className="cx-title"><h1>Connections</h1><p>Every app Onyx can work in. Onyx asks before it sends, deletes or publishes anything.</p></div>
      <div className="cx-summary" aria-live="polite">
        <span className="cx-meter" style={{ ["--cx-fill" as string]: `${(summary.connected / summary.total) * 100}%` }} aria-hidden />
        <strong>{summary.checking ? "Checking…" : `${summary.connected} of ${summary.total} connected`}</strong>
        <button type="button" className="cx-icon-button" onClick={() => void refresh()} aria-label="Check all connections again"><RefreshCw size={15} /></button>
      </div>
    </header>

    <div className="cx-toolbar">
      <div className="cx-segments" role="tablist" aria-label="Show">
        {(["all", "connected", "available"] as Filter[]).map((f) => <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}>{f === "all" ? "All" : f === "connected" ? "Connected" : "Not connected"}</button>)}
      </div>
      <label className="cx-search"><Search size={16} /><input type="search" placeholder="Search connections" aria-label="Search connections" value={query} onChange={(e) => setQuery(e.target.value)} />{query && <button type="button" aria-label="Clear search" onClick={() => setQuery("")}><X size={14} /></button>}</label>
    </div>

    {notice && <p className="cx-banner cx-ok" role="status"><Check size={16} />{notice}<button aria-label="Dismiss" onClick={() => setNotice("")}><X size={14} /></button></p>}
    {error && <p className="cx-banner cx-err" role="alert"><CircleAlert size={16} />{error}<button aria-label="Dismiss" onClick={() => setError("")}><X size={14} /></button></p>}

    {GROUP_ORDER.map((group) => {
      const items = visible.filter((c) => c.group === group);
      if (!items.length) return null;
      return <section key={group} className="cx-group" aria-labelledby={`cx-${group}`}>
        <h2 id={`cx-${group}`}>{group}</h2>
        <div className="cx-grid">{items.map((c) => {
          const status = statuses[c.id] ?? { state: "checking" as const };
          const manage = manageHref(c);
          const working = busy === c.id;
          const dev = (DEV as string[]).includes(c.id);
          return <article key={c.id} className="cx-card" data-state={status.state}>
            <div className="cx-card-top"><ToolLogo name={c.logo} /><StatusPill state={status.state} /></div>
            <h3>{c.name}</h3>
            <p className="cx-desc">{c.description}</p>
            <p className="cx-account">{status.state === "connected" ? <>{status.account ?? "Connected; account name not reported"}{status.lastHealthy ? <> · Last healthy <time dateTime={status.lastHealthy}>{new Date(status.lastHealthy).toLocaleString()}</time></> : null}</> : status.note ?? (status.state === "unavailable" ? "Status could not be checked. Try again." : " ")}</p>
            {c.id === "n8n" && status.state === "available" && <input className="cx-input" type="url" inputMode="url" placeholder="https://yourname.app.n8n.cloud" aria-label="Your n8n address" value={n8nUrl} onChange={(e) => setN8nUrl(e.target.value)} />}
            {picker?.id === c.id && <div className="cx-picker"><select aria-label={`Choose what ${c.name} Onyx can use`} value={picker.chosen} onChange={(e) => setPicker({ ...picker, chosen: e.target.value })}>{picker.items.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select><button className="cx-primary" disabled={working} onClick={() => void saveChoice()}>Save</button></div>}
            <div className="cx-actions">
              {status.state === "checking" ? <span className="cx-skeleton" aria-hidden />
                : status.state === "connected" ? <>
                  {dev && picker?.id !== c.id && <button className="cx-secondary" disabled={working} onClick={() => void choose(c.id as Provider)}>{c.id === "github" ? "Choose repository" : c.id === "n8n" ? "Choose workflow" : "Choose project"}</button>}
                  {manage && !dev && <Link className="cx-secondary" href={manage}>Open <ArrowUpRight size={14} /></Link>}
                  {(c.id === "mail" || c.id === "zee") && <Link className="cx-secondary" href={workspaceHref("chat", business)}>Use in Onyx <ArrowUpRight size={14} /></Link>}
                  {c.kind === "included" && <span className="cx-hint">Always on for every workspace</span>}
                  {c.kind !== "included" && c.id !== "shopify" && c.id !== "signal" && c.id !== "zee" && <button className="cx-quiet" disabled={working} onClick={() => setPendingDisconnect(c)}>Disconnect</button>}
                </>
                : status.state === "available" ? <button className="cx-primary" disabled={working} onClick={() => void connect(c)}>{working ? <Loader2 size={15} className="cx-spin" /> : null}Connect</button>
                : status.state === "unavailable" ? <button className="cx-secondary" onClick={() => void refresh()}>Check again</button>
                : <span className="cx-hint">Needs setup by Onixus</span>}
            </div>
          </article>;
        })}</div>
      </section>;
    })}
    {!visible.length && <div className="cx-empty"><Search size={22} /><p>No connections match.</p><button className="cx-secondary" onClick={() => { setQuery(""); setFilter("all"); }}>Show all</button></div>}
    <ConfirmDialog open={!!pendingDisconnect} title={`Disconnect ${pendingDisconnect?.name ?? "connection"}?`} description="Onyx will stop using this connection until you reconnect it. Your data in the other app stays there." confirmLabel="Disconnect" danger onClose={() => setPendingDisconnect(null)} onConfirm={() => { const connection = pendingDisconnect; setPendingDisconnect(null); if (connection) void disconnect(connection); }} />
  </main>;
}

function StatusPill({ state }: { state: ConnectorStatus["state"] }) {
  const label = { checking: "Checking", connected: "Connected", available: "Not connected", setup: "Needs setup", unavailable: "Can't check" }[state];
  return <span className="cx-pill" data-state={state}>{state === "checking" ? <Loader2 size={12} className="cx-spin" /> : <i aria-hidden />}{label}</span>;
}
