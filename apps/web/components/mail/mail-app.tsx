"use client";
import {useCallback, useEffect, useMemo, useRef, useState, type ReactNode} from "react";
import {Archive, ArrowLeft, Bot, CheckCheck, ChevronLeft, ChevronRight, File, Inbox, Mail, MailOpen, Menu, Paperclip, Pencil, RefreshCw,
  Reply, ReplyAll, Forward, Search, Send, ShieldAlert, Star, Tag, Trash2, X, Sparkles, OctagonAlert, Undo2} from "lucide-react";
import {gatewayAuthorizationHeaders} from "@/lib/client-session";
import "./mail-app.css";

// Onixus Mail: a Gmail-style client inside Workspace. Folders, list and conversation read the real
// mailbox; the Mail employee's work ("Needs you", "Handled by Onixus") sits beside them, and every
// send or approval is the owner's own click. Email content is untrusted and only displayed.

type Folder = "inbox" | "needs" | "handled" | "starred" | "sent" | "drafts" | "all" | "spam" | "trash";
type Tab = "primary" | "promotions" | "social" | "updates";
type Row = {id: string; from: string; fromName: string; subject: string; snippet: string; at: string; unread: boolean; starred: boolean; important: boolean; count: number; attachment: boolean; labels: string[]; sent: boolean};
type Msg = {id: string; from: string; fromName: string; to: string; cc: string; at: string; subject: string; text: string; html: string | null; messageIdHeader: string | null; references: string | null; unread: boolean; attachments: {id: string; filename: string; mimeType: string; size: number}[]};
type Thread = {id: string; subject: string; labels: string[]; starred: boolean; messages: Msg[]};
type Label = {id: string; name: string; unread: number; type: "system" | "user"};
type CrmDeal = {id: string; title: string; stage: string; value_cents: number | null; currency: string | null};
type CrmContext = {customer: {id: string; company: string; email: string | null} | null; deals: CrmDeal[];
  thread: {thread_id: string; subject: string; customer_id: string | null; quote_outcome: {status: string; reason: string} | null} | null};
type Crm = CrmContext | {unavailable: true} | null;
const money = (cents: number | null, currency: string | null) => cents == null ? "" : new Intl.NumberFormat([], {style: "currency", currency: currency || "USD"}).format(cents / 100);
type Plan = {action: string; headline?: string; purpose?: string; needs_review?: boolean; unsubscribe?: boolean; quote_check?: string; quote_note?: string};
type Work = {id: string; thread_id: string; from_email: string; from_name: string | null; subject: string; category: string | null; summary: string; priority: string; needs_owner: boolean; owner_reason: string | null; plan: Plan | null; draft: string | null; status: string; created_at: string};
type Draft = {key: string; to: string; cc: string; bcc: string; subject: string; body: string; threadId: string | null; inReplyTo: string | null; references: string | null; showCc: boolean; mode: "new" | "reply" | "forward"};

const FOLDERS: {key: Folder; label: string; icon: typeof Inbox}[] = [
  {key: "inbox", label: "Inbox", icon: Inbox}, {key: "needs", label: "Needs you", icon: Sparkles}, {key: "handled", label: "Handled by Onixus", icon: Bot},
  {key: "starred", label: "Starred", icon: Star}, {key: "sent", label: "Sent", icon: Send}, {key: "drafts", label: "Drafts", icon: File},
  {key: "all", label: "All Mail", icon: Mail}, {key: "spam", label: "Spam", icon: OctagonAlert}, {key: "trash", label: "Trash", icon: Trash2},
];
const TABS: {key: Tab; label: string}[] = [{key: "primary", label: "Primary"}, {key: "promotions", label: "Promotions"}, {key: "social", label: "Social"}, {key: "updates", label: "Updates"}];
const KIND: Record<string, string> = {JUNK: "Junk", NEWSLETTER: "Newsletter", COLD_OUTREACH: "Cold pitch", NOTIFICATION: "Notification", QUESTION: "Question", QUOTE_REQUEST: "Quote request", DOCUMENT: "Document", PERSONAL: "Personal", OTHER: "Other"};
const planCopy = (p: Plan | null) => !p ? "No action" : p.action === "trash" ? "Delete (moves to Trash)" : p.action === "archive" ? (p.unsubscribe ? "Unsubscribe and archive" : "Archive")
  : p.action === "reply" ? (p.purpose === "QUOTE" ? "Send this quote" : "Send this reply") : "No action";

function when(at: string) {
  const d = new Date(at), now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], {hour: "numeric", minute: "2-digit"});
  return d.getFullYear() === now.getFullYear() ? d.toLocaleDateString([], {month: "short", day: "numeric"}) : d.toLocaleDateString();
}
const fullWhen = (at: string) => new Date(at).toLocaleString([], {weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit"});
const initial = (s: string) => (s.trim()[0] ?? "?").toUpperCase();
const addrs = (s: string) => (s.match(/[^\s<>,;"']+@[^\s<>,;"']+/g) ?? []).map(a => a.toLowerCase());
const newKey = () => crypto.randomUUID();

/** Email HTML in a frame with scripts off, remote content blocked until the owner shows images. */
function EmailBody({m, images}: {m: Msg; images: boolean}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const doc = useMemo(() => {
    if (!m.html) return "";
    const img = images ? "data: cid: https: http:" : "data: cid:";
    // Remote stylesheets and fonts are remote content too: they wait for "Show images" like pictures do.
    const style = images ? "'unsafe-inline' https:" : "'unsafe-inline'";
    const font = images ? "https: data:" : "data:";
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${style}; font-src ${font}; img-src ${img}">`
      + `<base target="_blank"><style>body{margin:0;padding:16px;font:14px/1.55 Arial,Helvetica,sans-serif;color:#202124;background:#fff;word-break:break-word}img{max-width:100%;height:auto}</style></head><body>${m.html}</body></html>`;
  }, [m.html, images]);
  const fit = () => { const d = frame.current?.contentDocument; if (frame.current && d?.body) frame.current.style.height = Math.min(Math.max(d.documentElement.scrollHeight, 80), 20000) + "px"; };
  if (!m.html) return <div className="omail-text">{m.text || "(no message text)"}</div>;
  // No allow-scripts: email code never runs. allow-same-origin only lets this page size the frame.
  return <iframe ref={frame} className="omail-html" title={`Message from ${m.fromName}`} srcDoc={doc} onLoad={fit} sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer"/>;
}

export default function MailApp({onClose, toolbar}: {onClose?: () => void; toolbar?: ReactNode}) {
  const [mailbox, setMailbox] = useState<string>("");
  const [mailboxes, setMailboxes] = useState<string[]>([]);
  const [folder, setFolder] = useState<Folder>("inbox");
  const [tab, setTab] = useState<Tab>("primary");
  const [label, setLabel] = useState<Label | null>(null);
  const [labels, setLabels] = useState<Label[]>([]);
  const [q, setQ] = useState(""), [search, setSearch] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [pages, setPages] = useState<(string | null)[]>([null]);
  const [next, setNext] = useState<string | null>(null);
  const [needs, setNeeds] = useState<Work[]>([]), [handled, setHandled] = useState<Work[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [thread, setThread] = useState<Thread | null>(null);
  const [crm, setCrm] = useState<Crm>(null);
  const [crmForm, setCrmForm] = useState({company: "", email: ""});
  const [crmTask, setCrmTask] = useState({title: "", due: ""});
  const [images, setImages] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(false);
  const [error, setError] = useState(""), [toast, setToast] = useState("");
  const [rail, setRail] = useState(true);
  const searchBox = useRef<HTMLInputElement>(null);
  useEffect(() => { if (window.innerWidth < 900) setRail(false); }, []);

  const call = useCallback(async <T,>(params: Record<string, string | null | undefined>, body?: unknown): Promise<T> => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) u.set(k, v);
    if (mailbox) u.set("mailbox", mailbox);
    const r = await fetch(`/api/mail/box${body ? "" : "?" + u}`, {method: body ? "POST" : "GET", cache: "no-store",
      headers: {...await gatewayAuthorizationHeaders(), ...(body ? {"Content-Type": "application/json"} : {})}, body: body ? JSON.stringify({mailbox: mailbox || undefined, ...body as object}) : undefined});
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((data as {error?: string}).error ?? "Mail could not complete that.");
    return data as T;
  }, [mailbox]);
  const say = (t: string) => { setToast(t); window.setTimeout(() => setToast(c => c === t ? "" : c), 4000); };
  const report = (e: unknown) => setError(e instanceof Error ? e.message : "Mail could not complete that.");

  const loadLabels = useCallback(async () => {
    try {
      const r = await call<{mailbox: string; mailboxes: string[]; labels: Label[]}>({action: "labels"});
      setLabels(r.labels); setMailboxes(r.mailboxes); if (!mailbox) setMailbox(r.mailbox);
    } catch (e) { report(e); }
  }, [call, mailbox]);
  const loadWork = useCallback(async () => {
    try { setNeeds((await call<{items: Work[]}>({action: "work", status: "pending"})).items); } catch { /* the inbox still works without the employee */ }
  }, [call]);
  const loadList = useCallback(async (page: string | null = pages[pages.length - 1]) => {
    setLoading(true); setError("");
    try {
      if (folder === "needs") { await loadWork(); setRows(null); }
      else if (folder === "handled") { setHandled((await call<{items: Work[]}>({action: "work", status: "done"})).items); setRows(null); }
      else {
        const r = await call<{rows: Row[]; next: string | null}>({action: "list", folder: label ? "all" : folder, tab: folder === "inbox" && !label && !search ? tab : null, label: label?.id, q: search, page});
        setRows(r.rows); setNext(r.next);
      }
    } catch (e) { report(e); } finally { setLoading(false); }
  }, [call, folder, tab, label, search, pages, loadWork]);

  useEffect(() => { void loadLabels(); void loadWork(); }, [mailbox]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setPages([null]); setSelected(new Set()); void loadList(null); }, [folder, tab, label, search, mailbox]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { // new mail every minute while the list is showing
    if (open) return;
    const t = window.setInterval(() => { if (pages.length === 1) void loadList(null); void loadWork(); }, 60_000);
    return () => window.clearInterval(t);
  }, [open, pages.length, loadList, loadWork]);

  const openThread = useCallback(async (id: string) => {
    setOpen(id); setThread(null); setCrm(null); setImages(false); setError("");
    try {
      const r = await call<{thread: Thread; crm: Crm}>({action: "thread", id});
      setThread(r.thread); setCrm(r.crm ?? {unavailable: true});
      setCrmForm({company: "", email: r.thread.messages[r.thread.messages.length - 1]?.from ?? ""});
      if (r.thread.messages.some(m => m.unread)) { void call({}, {action: "act", id, op: "read"}).catch(() => undefined); setRows(rs => rs?.map(x => x.id === id ? {...x, unread: false} : x) ?? rs); }
    } catch (e) { report(e); setOpen(null); }
  }, [call]);
  const close = () => { setOpen(null); setThread(null); setCrm(null); };

  // CRM writes are the owner's own clicks; the server re-checks ownership in the database.
  const crmWrite = async (body: Record<string, unknown>, done: string) => {
    if (!thread) return;
    setBusy(true); setError("");
    try {
      await call({}, {...body, thread_id: thread.id, subject: thread.subject});
      say(done);
      const r = await call<{thread: Thread; crm: Crm}>({action: "thread", id: thread.id});
      setThread(r.thread); setCrm(r.crm ?? {unavailable: true});
    } catch (e) { report(e); } finally { setBusy(false); }
  };

  const act = async (ids: string[], op: string, done: string) => {
    if (!ids.length) return;
    setBusy(true); setError("");
    try {
      await call({}, {action: "act", ids, op});
      say(done);
      if (["archive", "trash", "spam", "untrash", "inbox", "notspam"].includes(op)) { setRows(rs => rs?.filter(r => !ids.includes(r.id)) ?? rs); if (open && ids.includes(open)) close(); }
      else if (op === "star" || op === "unstar") { setRows(rs => rs?.map(r => ids.includes(r.id) ? {...r, starred: op === "star"} : r) ?? rs); setThread(t => t && ids.includes(t.id) ? {...t, starred: op === "star"} : t); }
      else if (op === "read" || op === "unread") { setRows(rs => rs?.map(r => ids.includes(r.id) ? {...r, unread: op === "unread"} : r) ?? rs); if (op === "unread" && open) close(); }
      setSelected(new Set());
    } catch (e) { report(e); } finally { setBusy(false); }
  };

  const decide = async (w: Work, decision: "approve" | "skip") => {
    setBusy(true); setError("");
    try {
      const edited = edits[w.id];
      await call({}, {action: "decide", id: w.id, decision, draft: decision === "approve" && edited !== undefined && edited !== w.draft ? edited : null});
      say(decision === "approve" ? "Approved. Onixus does it within a minute." : "Skipped. Onixus will leave it alone.");
      setNeeds(n => n.filter(x => x.id !== w.id));
    } catch (e) { report(e); } finally { setBusy(false); }
  };

  const startReply = (m: Msg, mode: "reply" | "replyall" | "forward") => {
    if (!thread) return;
    const quoted = `\n\nOn ${fullWhen(m.at)}, ${m.fromName} <${m.from}> wrote:\n` + m.text.split("\n").slice(0, 400).map(l => "> " + l).join("\n");
    const subject = mode === "forward" ? (/^fwd?:/i.test(thread.subject) ? thread.subject : "Fwd: " + thread.subject) : (/^re:/i.test(thread.subject) ? thread.subject : "Re: " + thread.subject);
    const others = mode === "replyall" ? [...new Set([...addrs(m.to), ...addrs(m.cc)])].filter(a => a !== mailbox && a !== m.from) : [];
    const replyTo = m.from === mailbox ? addrs(m.to)[0] ?? "" : m.from;
    setDraft({key: newKey(), mode: mode === "forward" ? "forward" : "reply", subject, showCc: others.length > 0,
      to: mode === "forward" ? "" : replyTo, cc: others.join(", "), bcc: "",
      body: mode === "forward" ? `\n\n---------- Forwarded message ---------\nFrom: ${m.fromName} <${m.from}>\nDate: ${fullWhen(m.at)}\nSubject: ${m.subject}\nTo: ${m.to}\n\n${m.text}` : quoted,
      threadId: mode === "forward" ? null : thread.id, inReplyTo: mode === "forward" ? null : m.messageIdHeader, references: mode === "forward" ? null : [m.references, m.messageIdHeader].filter(Boolean).join(" ") || null});
  };
  const send = async () => {
    if (!draft) return;
    setBusy(true); setError("");
    try {
      await call({}, {action: "send", key: draft.key, to: draft.to, cc: draft.cc, bcc: draft.bcc, subject: draft.subject, body: draft.body,
        thread_id: draft.threadId, in_reply_to: draft.inReplyTo, references: draft.references});
      say("Message sent."); setDraft(null);
      if (draft.threadId && open === draft.threadId) void openThread(draft.threadId);
    } catch (e) { report(e); } finally { setBusy(false); }
  };
  const download = async (m: Msg, a: Msg["attachments"][number]) => {
    try {
      const u = new URLSearchParams({action: "attachment", message: m.id, attachment: a.id, name: a.filename});
      if (mailbox) u.set("mailbox", mailbox);
      const r = await fetch(`/api/mail/box?${u}`, {headers: await gatewayAuthorizationHeaders(), cache: "no-store"});
      if (!r.ok) throw new Error("Could not download that attachment.");
      const url = URL.createObjectURL(await r.blob());
      const link = Object.assign(document.createElement("a"), {href: url, download: a.filename});
      link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) { report(e); }
  };

  // Gmail's keys: c compose, / search, e archive, # delete, r reply, Esc back.
  // The handler is refreshed after every render and read through a ref, so the window listener is
  // attached once instead of being torn down and re-added on every render.
  const onKey = useRef<(e: KeyboardEvent) => void>(() => undefined);
  useEffect(() => {
    onKey.current = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "c" && !draft) { e.preventDefault(); setDraft({key: newKey(), mode: "new", to: "", cc: "", bcc: "", subject: "", body: "", threadId: null, inReplyTo: null, references: null, showCc: false}); }
      else if (e.key === "/") { e.preventDefault(); searchBox.current?.focus(); }
      else if (e.key === "Escape" && open) close();
      else if (open && thread && e.key === "e") void act([thread.id], "archive", "Archived.");
      else if (open && thread && e.key === "#") void act([thread.id], "trash", "Moved to Trash.");
      else if (open && thread && e.key === "r") { const m = thread.messages[thread.messages.length - 1]; if (m) startReply(m, "reply"); }
    };
  }); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const key = (e: KeyboardEvent) => onKey.current(e);
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  const inbox = labels.find(l => l.id === "INBOX");
  const onixusLabels = labels.filter(l => l.type === "user" && l.name.startsWith("Onixus/"));
  const otherLabels = labels.filter(l => l.type === "user" && !l.name.startsWith("Onixus/"));
  const pendingFor = (threadId: string) => needs.find(n => n.thread_id === threadId);
  const choose = (f: Folder) => { setFolder(f); setLabel(null); setSearch(""); setQ(""); close(); };
  const allChecked = !!rows?.length && rows.every(r => selected.has(r.id));
  const sel = [...selected];

  const suggestion = (w: Work) => <section className="omail-suggest" aria-label="Onixus suggestion">
    <div className="omail-suggest-head"><Sparkles size={16} aria-hidden/><strong>Onixus suggests: {planCopy(w.plan)}</strong>
      {w.category && <span className="omail-chip">{KIND[w.category] ?? w.category}</span>}{w.priority !== "NORMAL" && <span className={`omail-chip p-${w.priority.toLowerCase()}`}>{w.priority.toLowerCase()}</span>}</div>
    <p>{w.summary}</p>
    {w.needs_owner && w.owner_reason && <p className="omail-warn"><ShieldAlert size={14} aria-hidden/> {w.owner_reason}</p>}
    {w.plan?.quote_check && <p className="omail-warn"><ShieldAlert size={14} aria-hidden/> {w.plan.quote_check}</p>}
    {w.plan?.action === "reply" && <textarea aria-label="Reply Onixus drafted" rows={Math.min(14, Math.max(5, (edits[w.id] ?? w.draft ?? "").split("\n").length + 1))}
      value={edits[w.id] ?? w.draft ?? ""} onChange={e => setEdits({...edits, [w.id]: e.target.value})}/>}
    <div className="omail-suggest-actions">
      <button className="omail-primary" disabled={busy} onClick={() => void decide(w, "approve")}><CheckCheck size={15} aria-hidden/> {planCopy(w.plan)}</button>
      <button disabled={busy} onClick={() => void decide(w, "skip")}>Skip</button>
      <small>Nothing goes out until you approve.</small>
    </div>
  </section>;

  const workList = (items: Work[] | null, pending: boolean) => <ul className="omail-rows" aria-label={pending ? "Waiting for you" : "Handled by Onixus"}>
    {(items ?? []).map(w => <li key={w.id} className={pending ? "unread" : undefined}>
      <button className="omail-row" onClick={() => void openThread(w.thread_id)}>
        <span className="omail-from">{w.from_name || w.from_email}</span>
        <span className="omail-line">{w.category && <span className="omail-chip">{KIND[w.category] ?? w.category}</span>}<b>{w.subject || "(no subject)"}</b><span className="omail-snippet"> — {pending ? planCopy(w.plan) + ": " : ""}{w.summary}</span></span>
        <span className="omail-when">{when(w.created_at)}</span>
      </button></li>)}
    {items && !items.length && <li className="omail-empty">{pending ? "Nothing needs you right now. Onixus sorted everything else." : "Nothing handled yet."}</li>}
  </ul>;

  // The CRM strip under a conversation: who the sender is, their open deals, the quote outcome, and the follow-up.
  const crmStrip = () => {
    if (!thread || crm === null) return null;
    if ("unavailable" in crm) return <section className="omail-crm-bar" aria-label="CRM"><div className="omail-crm-head">CRM is unavailable right now. Mail still works.</div></section>;
    const outcome = crm.thread?.quote_outcome?.status ?? null, customer = crm.customer;
    return <section className="omail-crm-bar" aria-label="CRM">
      <div className="omail-crm-head">{customer ? `CRM · ${customer.company}` : "Not in CRM yet"}{outcome && <span className={`omail-chip ${outcome}`}>Quote {outcome}</span>}</div>
      {customer && crm.deals.length > 0 && <div className="omail-crm-row">{crm.deals.map(d => <small key={d.id}>{d.title || "Deal"} · {d.stage}{d.value_cents != null ? ` · ${money(d.value_cents, d.currency)}` : ""}</small>)}</div>}
      {!customer && <form className="omail-crm-row" onSubmit={e => { e.preventDefault(); void crmWrite({action: "crm_link", company: crmForm.company, email: crmForm.email}, "Linked to CRM."); }}>
        <input aria-label="Company" placeholder="Company" value={crmForm.company} onChange={e => setCrmForm({...crmForm, company: e.target.value})}/>
        <input aria-label="Sender email" placeholder="Email" value={crmForm.email} onChange={e => setCrmForm({...crmForm, email: e.target.value})}/>
        <button type="submit" disabled={busy || !(crmForm.company.trim() || crmForm.email.trim())}>Link customer</button>
      </form>}
      <div className="omail-crm-row" role="group" aria-label="Quote outcome">
        <small>Quote</small>
        {(["won", "lost", "pending"] as const).map(s => <button key={s} type="button" disabled={busy} aria-pressed={outcome === s}
          onClick={() => void crmWrite({action: "crm_outcome", status: s}, `Quote marked ${s}.`)}>{s}</button>)}
      </div>
      {customer && <form className="omail-crm-row" onSubmit={e => { e.preventDefault();
        void crmWrite({action: "crm_task", customer_id: customer.id, title: crmTask.title, due_at: crmTask.due ? new Date(`${crmTask.due}T09:00`).toISOString() : null}, "Follow-up added to CRM.");
        setCrmTask({title: "", due: ""}); }}>
        <input aria-label="Follow-up" placeholder="Follow up on…" value={crmTask.title} onChange={e => setCrmTask({...crmTask, title: e.target.value})}/>
        <input aria-label="Due date" type="date" value={crmTask.due} onChange={e => setCrmTask({...crmTask, due: e.target.value})}/>
        <button type="submit" disabled={busy || !crmTask.title.trim()}>Add follow-up</button>
      </form>}
    </section>;
  };

  return <section className="omail">
    <header className="omail-top">
      <button className="omail-icon" aria-label="Main menu" onClick={() => setRail(r => !r)}><Menu size={20}/></button>
      <div className="omail-brand"><img src="/brands/onixus-mail-icon-v2.png" width={26} height={26} alt=""/><strong>Onixus Mail</strong></div>
      <form className="omail-search" role="search" onSubmit={e => { e.preventDefault(); setLabel(null); if (["needs", "handled"].includes(folder)) setFolder("all"); setSearch(q); close(); }}>
        <Search size={18} aria-hidden/><input ref={searchBox} type="search" aria-label="Search mail" placeholder="Search mail" value={q} onChange={e => setQ(e.target.value)}/>
        {search && <button type="button" className="omail-icon" aria-label="Clear search" onClick={() => { setQ(""); setSearch(""); }}><X size={16}/></button>}
      </form>
      <div className="omail-top-right">
        {mailboxes.length > 1 ? <select aria-label="Mailbox" value={mailbox} onChange={e => { setMailbox(e.target.value); close(); }}>{mailboxes.map(m => <option key={m}>{m}</option>)}</select> : <span className="omail-me">{mailbox}</span>}
        {toolbar}
        {onClose && <button className="omail-link" onClick={onClose}>Back to canvas</button>}
      </div>
    </header>
    <div className="omail-body">
      <nav className={`omail-rail${rail ? "" : " collapsed"}`} aria-label="Mail folders">
        <button className="omail-compose" onClick={() => setDraft({key: newKey(), mode: "new", to: "", cc: "", bcc: "", subject: "", body: "", threadId: null, inReplyTo: null, references: null, showCc: false})}><Pencil size={18} aria-hidden/><span>Compose</span></button>
        <ul>{FOLDERS.map(f => { const Icon = f.icon; const count = f.key === "inbox" ? inbox?.unread : f.key === "needs" ? needs.length : 0;
          return <li key={f.key}><button aria-current={folder === f.key && !label ? "page" : undefined} className={f.key === "needs" && needs.length ? "attention" : undefined} onClick={() => choose(f.key)}>
            <Icon size={17} aria-hidden/><span>{f.label}</span>{!!count && <em>{count}</em>}</button></li>; })}</ul>
        {onixusLabels.length > 0 && <><h3>Sorted by Onixus</h3><ul>{onixusLabels.map(l => <li key={l.id}><button aria-current={label?.id === l.id ? "page" : undefined} onClick={() => { setLabel(l); setFolder("all"); setSearch(""); close(); }}><Tag size={15} aria-hidden/><span>{l.name.slice(7)}</span></button></li>)}</ul></>}
        {otherLabels.length > 0 && <><h3>Labels</h3><ul>{otherLabels.map(l => <li key={l.id}><button aria-current={label?.id === l.id ? "page" : undefined} onClick={() => { setLabel(l); setFolder("all"); setSearch(""); close(); }}><Tag size={15} aria-hidden/><span>{l.name}</span></button></li>)}</ul></>}
      </nav>
      <main className="omail-main">
        {error && <p className="omail-error" role="alert">{error}<button className="omail-icon" aria-label="Dismiss" onClick={() => setError("")}><X size={14}/></button></p>}
        {open ? <article className="omail-thread">
          <div className="omail-toolbar">
            <button className="omail-icon" aria-label="Back to list" onClick={close}><ArrowLeft size={18}/></button>
            {thread && <>
              {thread.labels.includes("INBOX") ? <button className="omail-icon" title="Archive (e)" aria-label="Archive" disabled={busy} onClick={() => void act([thread.id], "archive", "Archived.")}><Archive size={18}/></button>
                : <button className="omail-icon" title="Move to inbox" aria-label="Move to inbox" disabled={busy} onClick={() => void act([thread.id], thread.labels.includes("TRASH") ? "untrash" : "inbox", "Moved to Inbox.")}><Undo2 size={18}/></button>}
              {thread.labels.includes("SPAM") ? <button className="omail-icon" title="Not spam" aria-label="Not spam" onClick={() => void act([thread.id], "notspam", "Moved to Inbox.")}><Inbox size={18}/></button>
                : <button className="omail-icon" title="Report spam" aria-label="Report spam" disabled={busy} onClick={() => void act([thread.id], "spam", "Reported as spam.")}><OctagonAlert size={18}/></button>}
              {!thread.labels.includes("TRASH") && <button className="omail-icon" title="Delete (#)" aria-label="Delete" disabled={busy} onClick={() => void act([thread.id], "trash", "Moved to Trash. It stays there 30 days.")}><Trash2 size={18}/></button>}
              <button className="omail-icon" title="Mark as unread" aria-label="Mark as unread" disabled={busy} onClick={() => void act([thread.id], "unread", "Marked as unread.")}><Mail size={18}/></button>
              <button className="omail-icon" title={thread.starred ? "Unstar" : "Star"} aria-label={thread.starred ? "Unstar" : "Star"} disabled={busy} onClick={() => void act([thread.id], thread.starred ? "unstar" : "star", thread.starred ? "Unstarred." : "Starred.")}><Star size={18} className={thread.starred ? "starred" : undefined}/></button>
            </>}
          </div>
          {!thread ? <p className="omail-loading" role="status">Opening conversation…</p> : <>
            <h1>{thread.subject}</h1>
            <div className="omail-chips">{thread.labels.filter(l => l === "INBOX" || l.startsWith("Label_")).map(l => <span className="omail-chip" key={l}>{l === "INBOX" ? "Inbox" : labels.find(x => x.id === l)?.name.replace(/^Onixus\//, "") ?? "Label"}</span>)}</div>
            {crmStrip()}
            {pendingFor(thread.id) && suggestion(pendingFor(thread.id)!)}
            {thread.messages.some(m => m.html) && !images && <p className="omail-images">Images are hidden to protect your privacy. <button onClick={() => setImages(true)}>Show images</button></p>}
            {thread.messages.map((m, i) => <details className="omail-msg" key={m.id} open={i === thread.messages.length - 1 || m.unread}>
              <summary><span className="omail-avatar" aria-hidden>{initial(m.fromName)}</span>
                <span className="omail-msg-head"><strong>{m.fromName}</strong> <small>&lt;{m.from}&gt;</small><br/><small>to {m.to}{m.cc ? `, cc ${m.cc}` : ""}</small></span>
                <small className="omail-when">{fullWhen(m.at)}</small></summary>
              <EmailBody m={m} images={images}/>
              {m.attachments.length > 0 && <div className="omail-attachments">{m.attachments.map(a => <button key={a.id} onClick={() => void download(m, a)}><Paperclip size={14} aria-hidden/> {a.filename} <small>{Math.max(1, Math.round(a.size / 1024))} KB</small></button>)}</div>}
              <div className="omail-msg-actions">
                <button onClick={() => startReply(m, "reply")}><Reply size={15} aria-hidden/> Reply</button>
                {(addrs(m.to).length + addrs(m.cc).length > 1) && <button onClick={() => startReply(m, "replyall")}><ReplyAll size={15} aria-hidden/> Reply all</button>}
                <button onClick={() => startReply(m, "forward")}><Forward size={15} aria-hidden/> Forward</button>
              </div>
            </details>)}
          </>}
        </article> : <>
          {folder === "needs" ? <><div className="omail-toolbar"><button className="omail-icon" aria-label="Refresh" onClick={() => void loadList(null)}><RefreshCw size={17} className={loading ? "spin" : undefined}/></button><span className="omail-title">Needs you · Onixus sorted these and is waiting for your call</span></div>
            {needs.map(w => <div key={w.id} className="omail-needs"><button className="omail-row" onClick={() => void openThread(w.thread_id)}><span className="omail-from">{w.from_name || w.from_email}</span><span className="omail-line"><b>{w.subject || "(no subject)"}</b></span><span className="omail-when">{when(w.created_at)}</span></button>{suggestion(w)}</div>)}
            {!needs.length && <p className="omail-empty">Nothing needs you right now. Onixus sorted everything else.</p>}</>
          : folder === "handled" ? <><div className="omail-toolbar"><button className="omail-icon" aria-label="Refresh" onClick={() => void loadList(null)}><RefreshCw size={17} className={loading ? "spin" : undefined}/></button><span className="omail-title">Handled by Onixus · what it did with your approval or your autopilot rules</span></div>{workList(handled, false)}</>
          : <>
            <div className="omail-toolbar">
              <input type="checkbox" aria-label="Select all" checked={allChecked} onChange={e => setSelected(e.target.checked ? new Set(rows?.map(r => r.id)) : new Set())}/>
              <button className="omail-icon" aria-label="Refresh" onClick={() => void loadList(pages[pages.length - 1])}><RefreshCw size={17} className={loading ? "spin" : undefined}/></button>
              {sel.length > 0 && <>
                <button className="omail-icon" title="Archive" aria-label="Archive selected" disabled={busy} onClick={() => void act(sel, "archive", `Archived ${sel.length}.`)}><Archive size={17}/></button>
                <button className="omail-icon" title="Delete" aria-label="Delete selected" disabled={busy} onClick={() => void act(sel, folder === "trash" ? "untrash" : "trash", folder === "trash" ? `Restored ${sel.length}.` : `Moved ${sel.length} to Trash.`)}>{folder === "trash" ? <Undo2 size={17}/> : <Trash2 size={17}/>}</button>
                <button className="omail-icon" title="Mark as read" aria-label="Mark selected as read" disabled={busy} onClick={() => void act(sel, "read", "Marked as read.")}><MailOpen size={17}/></button>
                <button className="omail-icon" title="Mark as unread" aria-label="Mark selected as unread" disabled={busy} onClick={() => void act(sel, "unread", "Marked as unread.")}><Mail size={17}/></button>
              </>}
              <span className="omail-title">{label ? label.name.replace(/^Onixus\//, "Onixus · ") : search ? `Results for “${search}”` : FOLDERS.find(f => f.key === folder)?.label}</span>
              <span className="omail-pager">
                <button className="omail-icon" aria-label="Newer" disabled={pages.length < 2 || loading} onClick={() => { const p = pages.slice(0, -1); setPages(p); void loadList(p[p.length - 1]); }}><ChevronLeft size={17}/></button>
                <button className="omail-icon" aria-label="Older" disabled={!next || loading} onClick={() => { setPages([...pages, next]); void loadList(next); }}><ChevronRight size={17}/></button>
              </span>
            </div>
            {folder === "inbox" && !label && !search && <div className="omail-tabs" role="tablist">{TABS.map(t => <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}>{t.label}</button>)}</div>}
            {!rows ? <p className="omail-loading" role="status">Loading mail…</p> : <ul className="omail-rows">
              {rows.map(r => { const w = pendingFor(r.id); return <li key={r.id} className={`${r.unread ? "unread" : ""}${selected.has(r.id) ? " selected" : ""}`}>
                <input type="checkbox" aria-label={`Select ${r.subject}`} checked={selected.has(r.id)} onChange={e => { const s = new Set(selected); if (e.target.checked) s.add(r.id); else s.delete(r.id); setSelected(s); }}/>
                <button className="omail-star" aria-label={r.starred ? "Unstar" : "Star"} onClick={() => void act([r.id], r.starred ? "unstar" : "star", r.starred ? "Unstarred." : "Starred.")}><Star size={16} className={r.starred ? "starred" : undefined}/></button>
                <button className="omail-row" onClick={() => void openThread(r.id)}>
                  <span className="omail-from">{r.sent ? "me" : r.fromName}{r.count > 1 && <small> {r.count}</small>}</span>
                  <span className="omail-line">{w && <span className="omail-chip needs"><Sparkles size={11} aria-hidden/> Needs you</span>}<b>{r.subject}</b><span className="omail-snippet"> — {r.snippet}</span></span>
                  {r.attachment && <Paperclip size={14} className="omail-clip" aria-label="Has attachment"/>}
                  <span className="omail-when">{when(r.at)}</span>
                </button>
                <span className="omail-hover">
                  <button className="omail-icon" title="Archive" aria-label="Archive" onClick={() => void act([r.id], "archive", "Archived.")}><Archive size={16}/></button>
                  <button className="omail-icon" title="Delete" aria-label="Delete" onClick={() => void act([r.id], "trash", "Moved to Trash.")}><Trash2 size={16}/></button>
                  <button className="omail-icon" title={r.unread ? "Mark as read" : "Mark as unread"} aria-label={r.unread ? "Mark as read" : "Mark as unread"} onClick={() => void act([r.id], r.unread ? "read" : "unread", r.unread ? "Marked as read." : "Marked as unread.")}>{r.unread ? <MailOpen size={16}/> : <Mail size={16}/>}</button>
                </span>
              </li>; })}
              {!rows.length && <li className="omail-empty">{search ? "No messages matched your search." : "Nothing here."}</li>}
            </ul>}
          </>}
        </>}
      </main>
    </div>
    {draft && <div className="omail-compose-window" role="dialog" aria-label={draft.mode === "new" ? "New message" : draft.subject}>
      <header><strong>{draft.mode === "new" ? "New Message" : draft.subject || "New Message"}</strong><button className="omail-icon" aria-label="Discard draft" onClick={() => setDraft(null)}><X size={16}/></button></header>
      <label><span>To</span><input value={draft.to} onChange={e => setDraft({...draft, to: e.target.value})} autoFocus={draft.mode !== "reply"}/>{!draft.showCc && <button className="omail-link" onClick={() => setDraft({...draft, showCc: true})}>Cc Bcc</button>}</label>
      {draft.showCc && <><label><span>Cc</span><input value={draft.cc} onChange={e => setDraft({...draft, cc: e.target.value})}/></label><label><span>Bcc</span><input value={draft.bcc} onChange={e => setDraft({...draft, bcc: e.target.value})}/></label></>}
      <label><span>Subject</span><input value={draft.subject} onChange={e => setDraft({...draft, subject: e.target.value})}/></label>
      <textarea aria-label="Message" value={draft.body} autoFocus={draft.mode === "reply"} onChange={e => setDraft({...draft, body: e.target.value})} onFocus={e => { if (draft.mode === "reply") e.currentTarget.setSelectionRange(0, 0); }}/>
      <footer><button className="omail-primary" disabled={busy || !draft.to.trim()} onClick={() => void send()}><Send size={15} aria-hidden/> {busy ? "Sending…" : "Send"}</button>
        <small>From {mailbox}. Sends when you click Send.</small><button className="omail-icon" aria-label="Discard draft" onClick={() => setDraft(null)}><Trash2 size={16}/></button></footer>
    </div>}
    {toast && <p className="omail-toast" role="status">{toast}</p>}
  </section>;
}
