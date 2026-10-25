'use client';

import {useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode} from 'react';
import {Activity, AlertTriangle, ArrowUpRight, Bot, CheckCircle2, Columns3, Gauge, Inbox, Moon, Monitor, RefreshCw, Sun, Table2, Users, UserCheck} from 'lucide-react';
import {browserSupabase} from '@/lib/supabase';
import {previewData, previewWorkspace} from '@/lib/revenue/preview-data';
import {statusCopy, lifecycleSteps, type MessageStatus} from '@/lib/revenue/message-status';
import type {CustomerContext} from '@/lib/revenue/context';
import type {DealHealth, Recommendation} from '@/lib/revenue/insights';

type View = 'overview' | 'pipeline' | 'customers' | 'customer' | 'mail' | 'automation' | 'reviews';
type Theme = 'system' | 'light' | 'dark';
type Workspace = {id: string; name: string; environment: string; role: string};
type Json = Record<string, any>;

const views: {key: Exclude<View, 'customer'>; label: string; icon: typeof Gauge}[] = [
  {key: 'overview', label: 'Overview', icon: Gauge}, {key: 'pipeline', label: 'Pipeline', icon: Columns3}, {key: 'customers', label: 'Customers', icon: Users},
  {key: 'mail', label: 'Mail', icon: Inbox}, {key: 'automation', label: 'Automation', icon: Bot}, {key: 'reviews', label: 'Identity reviews', icon: UserCheck},
];

const money = (cents: number | null | undefined, currency = 'USD') => new Intl.NumberFormat(undefined, {style: 'currency', currency, maximumFractionDigits: 0}).format((cents ?? 0) / 100);
const when = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleString(undefined, {dateStyle: 'medium', timeStyle: 'short'}) : '—';
const since = (iso: string | null | undefined) => {
  if (!iso) return 'never';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (Math.abs(m) < 1) return 'just now';
  const f = new Intl.RelativeTimeFormat(undefined, {numeric: 'auto'});
  if (Math.abs(m) < 60) return f.format(-m, 'minute');
  if (Math.abs(m) < 1440) return f.format(-Math.round(m / 60), 'hour');
  return f.format(-Math.round(m / 1440), 'day');
};
const label = (s: string) => s.replace(/[_.]/g, ' ');

function readUrl() {
  const p = new URLSearchParams(window.location.search);
  return {view: (p.get('view') as View) || 'overview', customer: p.get('customer') ?? '', thread: p.get('thread') ?? '', message: p.get('message') ?? '', job: p.get('job') ?? '', w: p.get('w') ?? ''};
}

export default function RevenueApp({preview = false}: {preview?: boolean}) {
  const [theme, setTheme] = useState<Theme>('system');
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [w, setW] = useState('');
  const [view, setView] = useState<View>('overview');
  const [focus, setFocus] = useState({customer: '', thread: '', message: '', job: ''});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const main = useRef<HTMLElement>(null);

  useEffect(() => {
    const stored = localStorage.getItem('onixus-revenue-theme') as Theme | null;
    if (stored === 'light' || stored === 'dark') setTheme(stored);
    const u = readUrl();
    setView(u.view);
    setFocus({customer: u.customer, thread: u.thread, message: u.message, job: u.job});
    setReady(true);
    const onPop = () => { const x = readUrl(); setView(x.view); setFocus({customer: x.customer, thread: x.thread, message: x.message, job: x.job}); };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const chooseTheme = (t: Theme) => { setTheme(t); if (t === 'system') localStorage.removeItem('onixus-revenue-theme'); else localStorage.setItem('onixus-revenue-theme', t); };

  const token = useCallback(async () => {
    const db = browserSupabase();
    if (!db) throw new Error('Sign-in is not configured for this deployment.');
    const {data} = await db.auth.getSession();
    if (!data.session) throw new Error('Sign in with your Onixus Workspace account.');
    return data.session.access_token;
  }, []);

  const get = useCallback(async <T = Json,>(v: string, params: Record<string, string> = {}): Promise<T> => {
    if (preview) return previewData(v, params) as T;
    const q = new URLSearchParams({...(w ? {w} : {}), ...params});
    const r = await fetch(`/api/revenue/${v}?${q}`, {headers: {Authorization: `Bearer ${await token()}`}, cache: 'no-store'});
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error ?? `Request failed (${r.status}).`);
    return body as T;
  }, [preview, token, w]);

  const post = useCallback(async <T = Json,>(path: string, body: Json): Promise<T> => {
    if (preview) throw new Error('Preview uses sample data. Sign in to make changes.');
    const r = await fetch(`/api/revenue/${path}`, {method: 'POST', headers: {Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json'}, body: JSON.stringify({workspace_id: w, ...body})});
    const out = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(out.error ?? `Request failed (${r.status}).`);
    return out as T;
  }, [preview, token, w]);

  const act = useCallback(async (fn: string, args: Json, done?: string) => {
    setBusy(true); setError(''); setNotice('');
    try { const out = await post(`rpc/${fn}`, {args}); if (done) setNotice(done); setTick(t => t + 1); return out; }
    catch (e) { setError(e instanceof Error ? e.message : 'Request failed.'); return null; }
    finally { setBusy(false); }
  }, [post]);

  useEffect(() => {
    if (!ready) return;
    if (preview) { setSignedIn(true); setWorkspaces([previewWorkspace]); setW(previewWorkspace.id); return; }
    const db = browserSupabase();
    if (!db) { setSignedIn(false); return; }
    let live = true;
    db.auth.getSession().then(async ({data}) => {
      if (!live) return;
      setSignedIn(Boolean(data.session));
      if (!data.session) return;
      try {
        const r = await fetch('/api/revenue/workspaces', {headers: {Authorization: `Bearer ${data.session.access_token}`}, cache: 'no-store'});
        const body = await r.json();
        if (!r.ok) throw new Error(body.error);
        const list = body.workspaces as Workspace[];
        setWorkspaces(list);
        const wanted = readUrl().w || localStorage.getItem('onixus-revenue-workspace') || '';
        setW(list.find(x => x.id === wanted)?.id ?? list[0]?.id ?? '');
      } catch (e) { setError(e instanceof Error ? e.message : 'Could not load workspaces.'); }
    });
    return () => { live = false; };
  }, [ready, preview]);

  const go = useCallback((next: View, f: Partial<typeof focus> = {}) => {
    const nf = {customer: '', thread: '', message: '', job: '', ...f};
    setView(next); setFocus(nf); setError(''); setNotice('');
    const p = new URLSearchParams({view: next, ...Object.fromEntries(Object.entries(nf).filter(([, v]) => v))});
    window.history.pushState(null, '', `${preview ? '/revenue/preview' : '/revenue'}?${p}`);
    main.current?.focus();
  }, [preview]);

  const follow = useCallback((href: string) => {
    const u = new URL(href, window.location.origin);
    const p = u.searchParams;
    go((p.get('view') as View) || 'overview', {customer: p.get('customer') ?? '', thread: p.get('thread') ?? '', message: p.get('message') ?? '', job: p.get('job') ?? ''});
  }, [go]);

  const role = workspaces.find(x => x.id === w)?.role ?? 'viewer';
  const canEdit = role === 'owner' || role === 'member';
  const isOwner = role === 'owner';
  const shared = {get, act, post, follow, go, busy, canEdit, isOwner, tick, setError, setNotice, w, focus, preview};

  const onNavKey = (e: KeyboardEvent<HTMLElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button'));
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[n]?.focus(); e.preventDefault();
  };

  return (
    <div className="rev" data-theme={theme === 'system' ? undefined : theme}>
      <a className="rev-skip" href="#rev-main">Skip to content</a>
      <aside className="rev-side">
        <a className="rev-brand" href="/crm"><span>Onixus</span> <small>Revenue</small></a>
        <label className="rev-field"><span>Workspace</span>
          <select value={w} disabled={!workspaces.length || preview} onChange={e => { setW(e.target.value); localStorage.setItem('onixus-revenue-workspace', e.target.value); setTick(t => t + 1); }}>
            {workspaces.length ? workspaces.map(x => <option key={x.id} value={x.id}>{x.name}{x.environment !== 'production' ? ` (${x.environment})` : ''}</option>) : <option value="">No workspace</option>}
          </select>
        </label>
        <nav aria-label="Revenue sections" onKeyDown={onNavKey}>
          {views.map(v => <button key={v.key} type="button" aria-current={view === v.key || (v.key === 'customers' && view === 'customer') ? 'page' : undefined} onClick={() => go(v.key)}><v.icon size={17} aria-hidden/>{v.label}</button>)}
        </nav>
        <div className="rev-suite">
          <span>Onixus Workspace</span>
          <a href="/crm">CRM <ArrowUpRight size={14} aria-hidden/></a>
          <a href="/">Onixus Chat <ArrowUpRight size={14} aria-hidden/></a>
        </div>
        <fieldset className="rev-theme"><legend>Theme</legend>
          {([['system', Monitor], ['light', Sun], ['dark', Moon]] as const).map(([t, Icon]) =>
            <button key={t} type="button" aria-pressed={theme === t} onClick={() => chooseTheme(t)} title={`${t[0].toUpperCase()}${t.slice(1)} theme`}><Icon size={15} aria-hidden/><span className="rev-sr">{t} theme</span></button>)}
        </fieldset>
      </aside>
      <main id="rev-main" ref={main} tabIndex={-1} className="rev-main">
        {preview && <div className="rev-banner" role="note"><strong>Preview with sample data.</strong> Nothing on this page is from a real workspace, and changes are disabled.</div>}
        {error && <div className="rev-alert" role="alert">{error}</div>}
        {notice && <div className="rev-ok" role="status">{notice}</div>}
        {signedIn === false && <section className="rev-panel"><h1>Sign in to Onixus Revenue</h1><p>Use your Onixus Workspace account. Revenue shows the CRM, Mail and payment records of workspaces you belong to.</p><a className="rev-button primary" href="/crm">Go to sign-in</a> <a className="rev-button" href="/revenue/preview">View a preview with sample data</a></section>}
        {signedIn && !w && !error && <section className="rev-panel"><h1>No workspace yet</h1><p>Create a workspace in Onixus CRM first.</p><a className="rev-button primary" href="/crm">Open CRM</a></section>}
        {signedIn && w && <>
          {view === 'overview' && <Overview {...shared}/>}
          {view === 'pipeline' && <Pipeline {...shared}/>}
          {view === 'customers' && <Customers {...shared}/>}
          {view === 'customer' && <Customer {...shared}/>}
          {view === 'mail' && <Mail {...shared}/>}
          {view === 'automation' && <Automation {...shared}/>}
          {view === 'reviews' && <Reviews {...shared}/>}
        </>}
      </main>
    </div>
  );
}

type Shared = {
  get: <T = Json>(v: string, params?: Record<string, string>) => Promise<T>; act: (fn: string, args: Json, done?: string) => Promise<Json | null>;
  post: <T = Json>(path: string, body: Json) => Promise<T>; follow: (href: string) => void; go: (v: View, f?: Partial<{customer: string; thread: string; message: string; job: string}>) => void;
  busy: boolean; canEdit: boolean; isOwner: boolean; tick: number; setError: (s: string) => void; setNotice: (s: string) => void; w: string;
  focus: {customer: string; thread: string; message: string; job: string}; preview: boolean;
};

function useLoad<T>(s: Shared, view: string, params: Record<string, string> = {}) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [at, setAt] = useState('');
  const key = JSON.stringify(params);
  const reload = useCallback(async () => {
    setLoading(true);
    try { setData(await s.get<T>(view, JSON.parse(key))); setAt(new Date().toISOString()); }
    catch (e) { s.setError(e instanceof Error ? e.message : 'Could not load.'); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.get, view, key]);
  useEffect(() => { void reload(); }, [reload, s.tick, s.w]);
  return {data, loading, reload, at};
}

function Heading({title, children, sub, onRefresh, loading, at}: {title: string; children?: ReactNode; sub?: ReactNode; onRefresh?: () => void; loading?: boolean; at?: string}) {
  return <header className="rev-heading">
    <div><h1>{title}</h1>{sub && <p>{sub}</p>}</div>
    <div className="rev-actions">{children}{onRefresh && <button type="button" onClick={onRefresh} disabled={loading} aria-label="Refresh"><RefreshCw size={15} aria-hidden className={loading ? 'rev-spin' : undefined}/>{at ? <span className="rev-muted">Updated {since(at)}</span> : null}</button>}</div>
  </header>;
}

function Status({status}: {status: string}) {
  const c = statusCopy[status as MessageStatus];
  return <span className={`rev-status tone-${c?.tone ?? 'neutral'}`} title={c?.detail}>{c?.label ?? label(status)}</span>;
}

function Empty({children}: {children: ReactNode}) { return <p className="rev-empty">{children}</p>; }

// ---------- Overview ----------
function Overview(s: Shared) {
  const {data, loading, reload, at} = useLoad<{overview: Json; priorities: Json[]}>(s, 'overview');
  const [open, setOpen] = useState<string>('');
  if (!data) return <Heading title="Company overview" loading={loading}/>;
  const o = data.overview, m = o.metrics;
  const cur = (m.pipeline.currencies?.[0] as string) ?? 'USD';
  const openPipeline = Object.values(m.pipeline.open_by_stage as Record<string, {count: number; value_cents: number}>);
  const replyRate = m.outreach.threads_sent ? Math.round(100 * m.outreach.threads_replied / m.outreach.threads_sent) + '%' : 'No sends yet';
  const cards: {key: string; title: string; value: string; detail: string; def: string; drill?: string; rows?: [string, string][]}[] = [
    {key: 'leads', title: 'New leads', value: String(m.leads.total), detail: `${m.leads.inquiries} inquiries${m.leads.discovery_imports ? ` · ${m.leads.discovery_imports} discovery imports excluded` : ''}`, def: m.leads.definition, drill: '/revenue?view=customers', rows: Object.entries(m.leads.by_source as Record<string, number>).map(([k, v]) => [label(k), String(v)])},
    {key: 'pipeline', title: 'Open pipeline', value: m.pipeline.currencies?.length > 1 ? `${openPipeline.reduce((a, b) => a + b.count, 0)} deals` : money(openPipeline.reduce((a, b) => a + (b.value_cents ?? 0), 0), cur), detail: `${openPipeline.reduce((a, b) => a + b.count, 0)} open · ${m.pipeline.won} won · ${m.pipeline.lost} lost in period`, def: m.pipeline.definition, drill: '/revenue?view=pipeline', rows: Object.entries(m.pipeline.open_by_stage as Record<string, {count: number; value_cents: number}>).map(([k, v]) => [label(k), `${v.count} · ${money(v.value_cents, cur)}`])},
    {key: 'outreach', title: 'Reply rate', value: replyRate, detail: `${m.outreach.replies_received} replies · ${m.outreach.awaiting_approval} drafts awaiting approval`, def: m.outreach.definition, drill: '/revenue?view=mail', rows: Object.entries(m.outreach.by_status as Record<string, number>).map(([k, v]) => [statusCopy[k as MessageStatus]?.label ?? label(k), String(v)])},
    {key: 'bookings', title: 'Meetings booked', value: String(m.bookings.scheduled), detail: `${m.bookings.upcoming} upcoming · ${m.bookings.cancelled} cancelled`, def: m.bookings.definition},
    {key: 'payments', title: 'Collected', value: m.payments.known ? money(m.payments.collected_cents, cur) : 'Unknown', detail: m.payments.known ? `${money(m.payments.outstanding_cents, cur)} outstanding · ${money(m.payments.refunded_cents, cur)} refunded` : 'No payment integration is connected', def: m.payments.definition, rows: [['Outstanding', money(m.payments.outstanding_cents, cur)], ['Failed payments', String(m.payments.failed)]]},
    {key: 'onboarding', title: 'Onboarding', value: String(m.onboarding.active), detail: `${m.onboarding.started} started in period · ${m.onboarding.on_hold} on hold`, def: m.onboarding.definition},
    {key: 'commitments', title: 'Overdue commitments', value: String(m.commitments.overdue), detail: `${m.commitments.due_today} due today`, def: m.commitments.definition},
    {key: 'failures', title: 'Needs recovery', value: String(m.failures.failed_sends + m.failures.dead_jobs + m.failures.sync_problems), detail: m.failures.paused ? 'Automation is paused' : `${m.failures.identity_reviews} identity reviews open`, def: m.failures.definition, drill: '/revenue?view=automation',
      rows: [['Failed sends', String(m.failures.failed_sends)], ['Dead jobs', String(m.failures.dead_jobs)], ['Retrying jobs', String(m.failures.retrying_jobs)], ['Sync problems', String(m.failures.sync_problems)]]},
  ];
  return <>
    <Heading title="Company overview" sub={<>Last 30 days · generated {since(o.generated_at)} · latest activity {since(o.freshness.latest_event_at)}</>} onRefresh={reload} loading={loading} at={at}/>
    {!o.counts_in_production_reporting && <div className="rev-banner" role="note">This is a <strong>{o.environment}</strong> workspace. Its numbers are excluded from production reporting.</div>}
    <section aria-labelledby="pri-h" className="rev-panel">
      <h2 id="pri-h">Today&apos;s priorities</h2>
      {data.priorities.length ? <ol className="rev-priorities">{data.priorities.map((p, i) =>
        <li key={i} className={`sev-${p.severity}`}>
          <div><strong>{p.who ?? 'Workspace'}</strong><span>{p.why}</span><small>{p.action}{p.since ? ` · since ${since(p.since)}` : ''}</small></div>
          <a href={p.link} onClick={e => { e.preventDefault(); s.follow(p.link); }}>Open <ArrowUpRight size={14} aria-hidden/></a>
        </li>)}</ol> : <Empty>Nothing needs attention right now.</Empty>}
    </section>
    <section aria-label="Metrics" className="rev-metrics">
      {cards.map(c => <article key={c.key} className="rev-metric">
        <button type="button" aria-expanded={open === c.key} aria-controls={`metric-${c.key}`} onClick={() => setOpen(open === c.key ? '' : c.key)}>
          <span>{c.title}</span><strong>{c.value}</strong><small>{c.detail}</small>
        </button>
        {open === c.key && <div id={`metric-${c.key}`} className="rev-metric-detail">
          <p><strong>Definition.</strong> {c.def}</p>
          {c.rows?.length ? <dl>{c.rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl> : null}
          {c.drill && <a href={c.drill} onClick={e => { e.preventDefault(); s.follow(c.drill!); }}>See the records <ArrowUpRight size={14} aria-hidden/></a>}
        </div>}
      </article>)}
    </section>
    <div className="rev-grid">
      <section className="rev-panel" aria-labelledby="unk-h"><h2 id="unk-h">What these numbers do not include</h2>
        {o.unknowns.length ? <ul className="rev-list">{o.unknowns.map((u: string) => <li key={u}><AlertTriangle size={15} aria-hidden/><span>{u}</span></li>)}</ul> : <Empty>All sources are connected.</Empty>}
      </section>
      <section className="rev-panel" aria-labelledby="fresh-h"><h2 id="fresh-h">Data freshness</h2>
        <ul className="rev-list">
          {o.freshness.mail_sync.map((x: Json) => <li key={x.account_id}><Activity size={15} aria-hidden/><span>Mail {x.mailbox ?? 'account'}: <strong>{label(x.status)}</strong>, synced {since(x.last_synced_at)}{x.last_error ? ` — ${x.last_error}` : ''}</span></li>)}
          {o.freshness.integrations.map((x: Json, i: number) => <li key={i}><Activity size={15} aria-hidden/><span>{x.label} ({x.provider}): <strong>{x.status}</strong>, last success {since(x.last_success_at)}</span></li>)}
          {!o.freshness.mail_sync.length && !o.freshness.integrations.length && <li>No connected sources yet.</li>}
        </ul>
      </section>
    </div>
  </>;
}

// ---------- Pipeline ----------
type Stage = {key: string; label: string; position: number; outcome: string; probability: number | null};
type Deal = {id: string; customer_id: string; company: string; title: string; stage: string; value_cents: number; currency: string; stage_changed_at: string | null; created_at: string; next_task: {title: string; due_at: string | null} | null; last_customer_reply_at: string | null};

function Pipeline(s: Shared) {
  const {data, loading, reload, at} = useLoad<{stages: Stage[]; deals: Deal[]}>(s, 'pipeline');
  const [mode, setMode] = useState<'board' | 'table'>('board');
  const [editing, setEditing] = useState(false);
  const [drag, setDrag] = useState('');
  const [sort, setSort] = useState<{key: keyof Deal; dir: 1 | -1}>({key: 'created_at', dir: -1});
  const move = (deal: Deal, stage: string) => {
    if (stage === deal.stage) return;
    const st = data?.stages.find(x => x.key === stage);
    const reason = st?.outcome === 'lost' ? window.prompt('Why was this opportunity lost?') ?? '' : '';
    if (st?.outcome === 'lost' && !reason.trim()) return;
    void s.act('revenue_move_deal', {p_deal: deal.id, p_stage: stage, p_reason: reason || null}, `Moved "${deal.title}" to ${st?.label ?? stage}.`);
  };
  const rows = useMemo(() => [...(data?.deals ?? [])].sort((a, b) => {
    const x = a[sort.key] ?? '', y = b[sort.key] ?? '';
    return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
  }), [data, sort]);
  if (!data) return <Heading title="Pipeline" loading={loading}/>;
  const stageLabel = (k: string) => data.stages.find(x => x.key === k)?.label ?? label(k);
  const th = (key: keyof Deal, text: string) => <th scope="col" aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
    <button type="button" onClick={() => setSort({key, dir: sort.key === key ? (sort.dir === 1 ? -1 : 1) : 1})}>{text}</button></th>;
  return <>
    <Heading title="Pipeline" sub="Stage changes are always made by a person. Meetings, replies and payments are shown as evidence, not moved automatically (except a confirmed payment marks the deal won)." onRefresh={reload} loading={loading} at={at}>
      <div role="group" aria-label="Layout" className="rev-seg">
        <button type="button" aria-pressed={mode === 'board'} onClick={() => setMode('board')}><Columns3 size={15} aria-hidden/> Board</button>
        <button type="button" aria-pressed={mode === 'table'} onClick={() => setMode('table')}><Table2 size={15} aria-hidden/> Table</button>
      </div>
      {s.isOwner && <button type="button" onClick={() => setEditing(!editing)} aria-expanded={editing}>Configure stages</button>}
    </Heading>
    {editing && <StageEditor stages={data.stages} s={s} onDone={() => setEditing(false)}/>}
    {mode === 'board' ? <div className="rev-board" role="list" aria-label="Pipeline stages">
      {data.stages.map(st => {
        const deals = data.deals.filter(d => d.stage === st.key);
        const cur = deals[0]?.currency ?? 'USD';
        return <section key={st.key} role="listitem" className={`rev-stage outcome-${st.outcome}`} aria-labelledby={`st-${st.key}`}
          onDragOver={e => { if (s.canEdit) e.preventDefault(); }} onDrop={e => { e.preventDefault(); const d = data.deals.find(x => x.id === drag); if (d) move(d, st.key); setDrag(''); }}>
          <h2 id={`st-${st.key}`}>{st.label}<span>{deals.length} · {money(deals.reduce((a, b) => a + b.value_cents, 0), cur)}</span></h2>
          {deals.map(d => <article key={d.id} className="rev-card" draggable={s.canEdit} onDragStart={() => setDrag(d.id)}>
            <a href={`/revenue?view=customer&customer=${d.customer_id}`} onClick={e => { e.preventDefault(); s.go('customer', {customer: d.customer_id}); }}><strong>{d.company}</strong></a>
            <span>{d.title}</span>
            <span className="rev-value">{money(d.value_cents, d.currency)}</span>
            <small>In stage {since(d.stage_changed_at ?? d.created_at)}{d.last_customer_reply_at ? ` · customer replied ${since(d.last_customer_reply_at)}` : ''}</small>
            {d.next_task ? <small>Next: {d.next_task.title}{d.next_task.due_at ? ` (due ${since(d.next_task.due_at)})` : ''}</small> : <small className="rev-warn">No next step</small>}
            {s.canEdit && <label className="rev-move"><span className="rev-sr">Move {d.title} to stage</span>
              <select value={d.stage} onChange={e => move(d, e.target.value)} disabled={s.busy}>{data.stages.map(x => <option key={x.key} value={x.key}>{x.label}</option>)}</select></label>}
          </article>)}
          {!deals.length && <Empty>No opportunities.</Empty>}
        </section>;
      })}
    </div> : <div className="rev-table-wrap"><table className="rev-table">
      <caption className="rev-sr">Opportunities</caption>
      <thead><tr>{th('company', 'Customer')}{th('title', 'Opportunity')}{th('stage', 'Stage')}{th('value_cents', 'Value')}{th('stage_changed_at', 'Stage changed')}<th scope="col">Next step</th></tr></thead>
      <tbody>{rows.map(d => <tr key={d.id}>
        <td><a href={`/revenue?view=customer&customer=${d.customer_id}`} onClick={e => { e.preventDefault(); s.go('customer', {customer: d.customer_id}); }}>{d.company}</a></td>
        <td>{d.title}</td>
        <td>{s.canEdit ? <select aria-label={`Stage for ${d.title}`} value={d.stage} onChange={e => move(d, e.target.value)} disabled={s.busy}>{data.stages.map(x => <option key={x.key} value={x.key}>{x.label}</option>)}</select> : stageLabel(d.stage)}</td>
        <td>{money(d.value_cents, d.currency)}</td><td>{when(d.stage_changed_at)}</td><td>{d.next_task?.title ?? <span className="rev-warn">None</span>}</td>
      </tr>)}</tbody>
    </table>{!rows.length && <Empty>No opportunities yet. Inquiries create them automatically.</Empty>}</div>}
  </>;
}

function StageEditor({stages, s, onDone}: {stages: Stage[]; s: Shared; onDone: () => void}) {
  const [rows, setRows] = useState(stages.map(x => ({...x})));
  const set = (i: number, k: keyof Stage, v: string) => setRows(rows.map((r, j) => j === i ? {...r, [k]: k === 'probability' ? (v === '' ? null : Number(v)) : v} : r));
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const out = await s.act('revenue_save_stages', {p_stages: rows.map(r => ({key: r.key.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_'), label: r.label.trim(), outcome: r.outcome, probability: r.probability}))}, 'Stages saved.');
    if (out) onDone();
  };
  return <form className="rev-panel rev-stages" onSubmit={save} aria-label="Configure stages">
    <p>Stages are ordered top to bottom. Keep at least one won and one lost stage. A stage that still has opportunities cannot be removed.</p>
    {rows.map((r, i) => <fieldset key={i}><legend className="rev-sr">Stage {i + 1}</legend>
      <label>Key<input value={r.key} onChange={e => set(i, 'key', e.target.value)} required pattern="[a-z0-9_]{1,40}" disabled={stages.some(x => x.key === r.key) && i < stages.length}/></label>
      <label>Label<input value={r.label} onChange={e => set(i, 'label', e.target.value)} required maxLength={60}/></label>
      <label>Outcome<select value={r.outcome} onChange={e => set(i, 'outcome', e.target.value)}><option value="open">Open</option><option value="won">Won</option><option value="lost">Lost</option></select></label>
      <label>Probability %<input type="number" min={0} max={100} value={r.probability ?? ''} onChange={e => set(i, 'probability', e.target.value)}/></label>
      <div className="rev-actions">
        <button type="button" aria-label={`Move ${r.label} up`} disabled={i === 0} onClick={() => { const n = [...rows]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; setRows(n); }}>↑</button>
        <button type="button" aria-label={`Move ${r.label} down`} disabled={i === rows.length - 1} onClick={() => { const n = [...rows]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; setRows(n); }}>↓</button>
        <button type="button" aria-label={`Remove ${r.label}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</button>
      </div>
    </fieldset>)}
    <div className="rev-actions">
      <button type="button" onClick={() => setRows([...rows, {key: `stage_${rows.length + 1}`, label: 'New stage', position: rows.length, outcome: 'open', probability: null}])}>Add stage</button>
      <button type="submit" className="primary" disabled={s.busy}>Save stages</button>
      <button type="button" onClick={onDone}>Cancel</button>
    </div>
  </form>;
}

// ---------- Customers ----------
function Customers(s: Shared) {
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  useEffect(() => { const t = setTimeout(() => setTerm(q), 250); return () => clearTimeout(t); }, [q]);
  const {data, loading, reload, at} = useLoad<{customers: Json[]}>(s, 'customers', term ? {q: term} : {});
  return <>
    <Heading title="Customers" sub="One record per person or business across CRM, Mail, forms and payments." onRefresh={reload} loading={loading} at={at}/>
    <label className="rev-field rev-search"><span>Search customers</span><input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Company, name or email"/></label>
    <div className="rev-table-wrap"><table className="rev-table">
      <thead><tr><th scope="col">Customer</th><th scope="col">Contact</th><th scope="col">Source</th><th scope="col">Added</th><th scope="col">Flags</th></tr></thead>
      <tbody>{(data?.customers ?? []).map(c => <tr key={c.id}>
        <td><a href={`/revenue?view=customer&customer=${c.id}`} onClick={e => { e.preventDefault(); s.go('customer', {customer: c.id}); }}>{c.company || c.name}</a></td>
        <td>{c.name}<br/><small>{c.email ?? 'No email'}</small></td><td>{label(c.source)}</td><td>{when(c.created_at)}</td>
        <td>{c.identity_review_required && <span className="rev-status tone-progress">Identity review</span>} {c.suppressed && <span className="rev-status tone-bad">Do not email</span>}</td>
      </tr>)}</tbody>
    </table>{data && !data.customers.length && <Empty>No customers match.</Empty>}</div>
  </>;
}

function Customer(s: Shared) {
  const id = s.focus.customer;
  const {data, loading, reload, at} = useLoad<{context?: CustomerContext; health?: DealHealth[]; actions?: Recommendation[]; merged_into?: string}>(s, 'customer', {id});
  const [memory, setMemory] = useState({content: '', kind: 'fact', source: 'conversation', visibility: 'workspace'});
  useEffect(() => { if (data?.merged_into) s.go('customer', {customer: data.merged_into}); }, [data?.merged_into]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!id) return <Empty>Choose a customer.</Empty>;
  const ctx = data?.context;
  if (!ctx) return <Heading title="Customer" loading={loading}/>;
  const c = ctx.customer;
  const addMemory = async (e: FormEvent) => {
    e.preventDefault();
    const out = await s.act('revenue_record_memory', {p_customer: c.id, p_content: memory.content, p_kind: memory.kind, p_source: memory.source, p_source_ref: null, p_confidence: memory.kind === 'inference' ? 0.5 : null, p_visibility: memory.visibility}, 'Memory saved.');
    if (out) setMemory({...memory, content: ''});
  };
  const decide = (mid: string, decision: string) => {
    let corrected: string | null = null, reason: string | null = null;
    if (decision === 'correct') { corrected = window.prompt('Corrected memory'); if (!corrected?.trim()) return; }
    if (decision === 'reject') { reason = window.prompt('Why is this wrong? (optional)') ?? null; }
    void s.act('revenue_decide_memory', {p_memory: mid, p_decision: decision, p_reason: reason, p_corrected: corrected}, 'Memory updated.');
  };
  return <>
    <Heading title={c.company || c.name} sub={<>{c.name}{c.job_title ? `, ${c.job_title}` : ''} · {c.email ?? 'no email'}{c.phone ? ` · ${c.phone}` : ''} · source {label(c.source)}</>} onRefresh={reload} loading={loading} at={at}>
      <button type="button" onClick={() => s.go('customers')}>All customers</button>
    </Heading>
    {c.identity_review_required && <div className="rev-banner" role="note">This record may be a duplicate. <a href="/revenue?view=reviews" onClick={e => { e.preventDefault(); s.go('reviews'); }}>Review it</a> before relying on its history.</div>}
    {ctx.contactability.blocked_reason && <div className="rev-alert" role="note">Do not email this customer: {label(ctx.contactability.blocked_reason)}.</div>}
    <div className="rev-grid">
      <section className="rev-panel" aria-labelledby="nba-h"><h2 id="nba-h">Next best actions</h2>
        {data?.actions?.length ? <ol className="rev-list">{data.actions.map((a, i) => <li key={i}><CheckCircle2 size={15} aria-hidden/><div>
          <strong>{a.action}</strong><span>{a.reason}</span>
          <small>{a.requires_approval ? 'Needs your approval before anything is sent. ' : ''}Based on: {a.sources.map((x, j) => <a key={j} href={x.link} onClick={e => { e.preventDefault(); s.follow(x.link); }}>{x.label}{j < a.sources.length - 1 ? ', ' : ''}</a>)}</small>
        </div></li>)}</ol> : <Empty>No suggested actions.</Empty>}
      </section>
      <section className="rev-panel" aria-labelledby="deal-h"><h2 id="deal-h">Opportunities</h2>
        {ctx.deals.map(d => { const h = data?.health?.find(x => x.deal_id === d.id); return <div key={d.id} className="rev-deal">
          <div><strong>{d.title}</strong> <span className="rev-muted">{label(d.stage)} · {money(d.value_cents, d.currency)}</span></div>
          {h && <><span className={`rev-status health-${h.status}`}>{label(h.status)}</span><p>{h.summary}</p>
            <ul className="rev-signals">{h.signals.map((sg, i) => <li key={i} className={`effect-${sg.effect}`}>{sg.label}{sg.evidence && <> · <a href={sg.evidence.link} onClick={e => { e.preventDefault(); s.follow(sg.evidence!.link); }}>{label(sg.evidence.kind)} {since(sg.evidence.at)}</a></>}</li>)}</ul></>}
        </div>; })}
        {!ctx.deals.length && <Empty>No opportunities.</Empty>}
        {ctx.meetings.length > 0 && <><h3>Meetings</h3><ul className="rev-list">{ctx.meetings.map(m => <li key={m.id}><span>{m.title} — {when(m.starts_at)} ({m.status})</span></li>)}</ul></>}
        {ctx.proposals.length > 0 && <><h3>Proposals</h3><ul className="rev-list">{ctx.proposals.map(p => <li key={p.id}><span>{p.title} — {money(p.amount_cents, p.currency)} · <strong>{label(p.status)}</strong>{p.amount_paid_cents ? ` · ${money(p.amount_paid_cents, p.currency)} confirmed paid` : ''}</span></li>)}</ul></>}
        {ctx.onboarding.length > 0 && <><h3>Onboarding</h3><ul className="rev-list">{ctx.onboarding.map(o => <li key={o.id}><span>{label(o.status)} since {when(o.started_at)}{o.hold_reason ? ` — ${o.hold_reason}` : ''}</span></li>)}</ul></>}
      </section>
    </div>
    <div className="rev-grid">
      <section className="rev-panel" aria-labelledby="tl-h"><h2 id="tl-h">Timeline</h2>
        <ol className="rev-timeline">{ctx.timeline.map(e => <li key={e.id} id={`event-${e.id}`}>
          <div className="rev-tl-head"><strong>{label(e.kind)}</strong><span className={`rev-status tone-${statusCopy[e.status as MessageStatus]?.tone ?? (e.status === 'failed' ? 'bad' : 'neutral')}`}>{statusCopy[e.status as MessageStatus]?.label ?? label(e.status)}</span></div>
          <p className={e.untrusted ? 'rev-untrusted' : undefined}>{e.summary}</p>
          <small>{when(e.occurred_at)} · {e.actor_label ?? label(e.actor_type)} via {e.source}{e.untrusted ? ' · customer-written content' : ''}</small>
          {e.recovery && <small className="rev-warn">Recovery: {e.recovery}</small>}
        </li>)}</ol>
        {!ctx.timeline.length && <Empty>No activity yet.</Empty>}
      </section>
      <section className="rev-panel" aria-labelledby="mem-h"><h2 id="mem-h">Memory</h2>
        <p className="rev-muted">Facts are confirmed by a teammate. Inferences are suggestions and are never stated to customers as fact.</p>
        <h3>Confirmed facts</h3>
        <ul className="rev-memory">{ctx.memory.facts.map(m => <li key={m.id}><p>{m.content}</p><small>Source: {m.source}{m.source_ref ? ` (${m.source_ref})` : ''} · confirmed {when(m.confirmed_at)}{m.visibility === 'owners' ? ' · owners only' : ''}{m.expires_at ? ` · expires ${when(m.expires_at)}` : ''}</small>
          {s.canEdit && <div className="rev-actions"><button type="button" onClick={() => decide(m.id, 'correct')}>Correct</button><button type="button" onClick={() => decide(m.id, 'expire')}>Expire</button><button type="button" onClick={() => decide(m.id, 'delete')}>Delete</button></div>}</li>)}</ul>
        {!ctx.memory.facts.length && <Empty>No confirmed facts.</Empty>}
        <h3>Unconfirmed inferences</h3>
        <ul className="rev-memory">{ctx.memory.inferences.map(m => <li key={m.id}><p>{m.content}</p><small>Source: {m.source} · confidence {Math.round(m.confidence * 100)}% · {when(m.recorded_at)}</small>
          {s.canEdit && <div className="rev-actions"><button type="button" onClick={() => decide(m.id, 'approve')}>Confirm</button><button type="button" onClick={() => decide(m.id, 'correct')}>Correct</button><button type="button" onClick={() => decide(m.id, 'reject')}>Reject</button></div>}</li>)}</ul>
        {!ctx.memory.inferences.length && <Empty>No inferences waiting.</Empty>}
        {s.canEdit && <form className="rev-form" onSubmit={addMemory}>
          <label>Add to memory<textarea rows={2} value={memory.content} onChange={e => setMemory({...memory, content: e.target.value})} required maxLength={2000}/></label>
          <div className="rev-row">
            <label>Type<select value={memory.kind} onChange={e => setMemory({...memory, kind: e.target.value})}><option value="fact">Confirmed fact</option><option value="inference">Inference</option></select></label>
            <label>Source<input value={memory.source} onChange={e => setMemory({...memory, source: e.target.value})} required maxLength={120}/></label>
            <label>Visible to<select value={memory.visibility} onChange={e => setMemory({...memory, visibility: e.target.value})}><option value="workspace">Workspace</option><option value="owners">Owners only</option></select></label>
          </div>
          <button type="submit" className="primary" disabled={s.busy}>Save memory</button>
        </form>}
        <h3>Open tasks</h3>
        <ul className="rev-list">{ctx.open_tasks.map(t => <li key={t.id}><span className={t.overdue ? 'rev-warn' : undefined}>{t.title}{t.due_at ? ` — due ${when(t.due_at)}` : ''}</span>
          {s.canEdit && <button type="button" onClick={() => void s.act('revenue_complete_task', {p_task: t.id}, 'Task completed.')}>Done</button>}</li>)}</ul>
        {!ctx.open_tasks.length && <Empty>No open tasks.</Empty>}
      </section>
    </div>
  </>;
}

// ---------- Mail ----------
type Msg = {id: string; customer_id: string | null; direction: string; purpose: string; status: MessageStatus; to_email: string | null; from_email: string | null; subject: string; thread_id: string | null; account_id: string | null; ai_generated: boolean; approval_source: string | null; failure: {reason?: string; detail?: string} | null; created_at: string; updated_at: string; approved_at: string | null; queued_at: string | null; provider_accepted_at: string | null; delivered_at: string | null; replied_at: string | null; failed_at: string | null};
type Thread = {account_id: string; thread_id: string; customer_id: string | null; subject: string; state: string | null; assigned_to: string | null; reply_lock_by: string | null; reply_lock_until: string | null; last_inbound_at: string | null; unanswered_questions: string[] | null; last_event_at: string};

function Mail(s: Shared) {
  const [filter, setFilter] = useState('');
  const {data, loading, reload, at} = useLoad<{messages: Msg[]; threads: Thread[]; sync: Json[]; identities: Json[]}>(s, 'mail', filter ? {status: filter} : {});
  const [thread, setThread] = useState<Thread | null>(null);
  useEffect(() => { if (data && s.focus.thread && !thread) setThread(data.threads.find(t => t.thread_id === s.focus.thread) ?? null); }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data) return <Heading title="Onixus Mail" loading={loading}/>;
  const waiting = data.threads.filter(t => t.state === 'waiting_on_us');
  return <>
    <Heading title="Onixus Mail" sub="Nothing is sent without approval. “Accepted by provider” means Gmail took the message; it is not proof of delivery." onRefresh={reload} loading={loading} at={at}/>
    <section className="rev-panel" aria-labelledby="sync-h"><h2 id="sync-h">Mailbox sync</h2>
      {data.sync.length ? <ul className="rev-list">{data.sync.map(x => <li key={x.account_id}><Activity size={15} aria-hidden/><span>{x.mailbox ?? 'Mailbox'} ({x.provider}): <strong>{label(x.status)}</strong> · last synced {since(x.last_synced_at)} · {x.messages_synced} messages{x.last_error ? <span className="rev-warn"> — {x.last_error}{x.status === 'expired' ? '. Reconnect Google in Onixus Mail.' : ''}</span> : null}</span></li>)}</ul>
        : <Empty>No mailbox is syncing into this workspace yet. Connect Google in Onixus Mail; sync status will appear here.</Empty>}
    </section>
    <div className="rev-grid">
      <section className="rev-panel" aria-labelledby="thr-h"><h2 id="thr-h">Conversations waiting on us ({waiting.length})</h2>
        <ul className="rev-threads">{data.threads.map(t => <li key={`${t.account_id}:${t.thread_id}`}>
          <button type="button" aria-pressed={thread?.thread_id === t.thread_id} onClick={() => setThread(t)}>
            <strong>{t.subject || '(no subject)'}</strong>
            <small>{label(t.state ?? 'open')} · {since(t.last_event_at)}{t.unanswered_questions?.length ? ` · ${t.unanswered_questions.length} open question(s)` : ''}{t.reply_lock_until && new Date(t.reply_lock_until) > new Date() ? ' · a teammate is replying' : ''}</small>
          </button></li>)}</ul>
        {!data.threads.length && <Empty>No conversations yet.</Empty>}
      </section>
      {thread ? <ThreadPanel s={s} thread={thread} identities={data.identities} onClose={() => setThread(null)}/> : <section className="rev-panel"><h2>Conversation</h2><Empty>Choose a conversation to read it, summarize it and draft a reply.</Empty></section>}
    </div>
    <section className="rev-panel" aria-labelledby="msg-h">
      <div className="rev-heading"><h2 id="msg-h">Messages</h2>
        <label className="rev-field"><span>Status</span><select value={filter} onChange={e => setFilter(e.target.value)}><option value="">All</option>{Object.entries(statusCopy).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label></div>
      <ul className="rev-messages">{data.messages.map(m => <li key={m.id} id={`message-${m.id}`} className={s.focus.message === m.id ? 'rev-focus' : undefined}>
        <div className="rev-tl-head"><strong>{m.subject || '(no subject)'}</strong><Status status={m.status}/></div>
        <small>{m.direction === 'inbound' ? `From ${m.from_email ?? 'customer'}` : `To ${m.to_email}`} · {label(m.purpose)}{m.ai_generated ? ' · drafted by Onyx' : ''}{m.approval_source ? ` · approved by ${m.approval_source}` : ''}</small>
        {m.direction === 'outbound' && <ol className="rev-steps" aria-label="Delivery progress">{lifecycleSteps(m).map(st => <li key={st.status} className={st.at ? 'done' : undefined}>{statusCopy[st.status].label}{st.at ? <span className="rev-sr"> at {when(st.at)}</span> : <span className="rev-sr"> not yet</span>}</li>)}</ol>}
        {m.failure && <p className="rev-warn">Failed: {m.failure.detail ?? m.failure.reason}. {m.failure.reason === 'bounce' ? 'The address is now suppressed; verify it before contacting them again.' : 'Fix the cause, then retry.'}</p>}
        {s.canEdit && <div className="rev-actions">
          {m.status === 'drafted' && <button type="button" className="primary" disabled={s.busy} onClick={() => void s.act('revenue_approve_message', {p_message: m.id}, 'Approved. It will be queued for sending; this page shows when the provider accepts it.')}>Approve and send</button>}
          {['drafted', 'approved', 'queued'].includes(m.status) && <button type="button" disabled={s.busy} onClick={() => { const r = window.prompt('Reason for cancelling?'); if (r !== null) void s.act('revenue_cancel_message', {p_message: m.id, p_reason: r || 'cancelled'}, 'Cancelled. It will not be sent.'); }}>Cancel</button>}
          {m.status === 'failed' && m.failure?.reason !== 'bounce' && <button type="button" disabled={s.busy} onClick={() => void s.act('revenue_retry_message', {p_message: m.id}, 'Queued for another attempt.')}>Retry</button>}
          {m.customer_id && <a href={`/revenue?view=customer&customer=${m.customer_id}`} onClick={e => { e.preventDefault(); s.go('customer', {customer: m.customer_id!}); }}>Customer</a>}
        </div>}
      </li>)}</ul>
      {!data.messages.length && <Empty>No messages{filter ? ' with this status' : ''}.</Empty>}
    </section>
  </>;
}

function ThreadPanel({s, thread, identities, onClose}: {s: Shared; thread: Thread; identities: Json[]; onClose: () => void}) {
  const {data, reload} = useLoad<{messages: Json[]; comments: Json[]; summary: {summary: string; action_items: string[]; questions: string[]; flags: string[]}}>(s, 'thread', {account: thread.account_id, thread: thread.thread_id});
  const [draft, setDraft] = useState<{subject: string; body: string; flags: string[]; context_used: string[]} | null>(null);
  const [comment, setComment] = useState('');
  const t = (action: string, value: Json = {}, done?: string) => s.act('revenue_thread_action', {p_account: thread.account_id, p_thread: thread.thread_id, p_action: action, p_value: value}, done);
  const makeDraft = async () => {
    if (!thread.customer_id) return s.setError('Link this conversation to a customer before drafting.');
    const claimed = await t('claim', {minutes: 15});
    if (!claimed) return;
    try { const r = await s.post<{draft: typeof draft}>('draft-reply', {customer: thread.customer_id, account: thread.account_id, thread: thread.thread_id}); setDraft(r.draft); }
    catch (e) { s.setError(e instanceof Error ? e.message : 'Could not draft.'); }
  };
  const saveDraft = async () => {
    if (!draft || !thread.customer_id) return;
    const lastIn = [...(data?.messages ?? [])].reverse().find(m => m.direction === 'inbound');
    const out = await s.act('revenue_draft_message', {p_draft: {customer_id: thread.customer_id, account_id: thread.account_id, thread_id: thread.thread_id, to: lastIn?.from_email, subject: draft.subject, body: draft.body, purpose: 'reply', ai_generated: true, sender_identity_id: identities[0]?.id ?? null, idempotency_key: `reply:${thread.thread_id}:${Date.now()}`}}, 'Draft saved. Approve it in the message list to send.');
    if (out) { setDraft(null); void reload(); }
  };
  return <section className="rev-panel" aria-labelledby="thread-h">
    <div className="rev-heading"><h2 id="thread-h">{thread.subject || '(no subject)'}</h2><button type="button" onClick={onClose}>Close</button></div>
    {data && <>
      <div className="rev-summary"><strong>Summary</strong><p>{data.summary.summary}</p>
        {data.summary.action_items.length > 0 && <ul>{data.summary.action_items.map(a => <li key={a}>{a}</li>)}</ul>}
        {data.summary.flags.length > 0 && <p className="rev-warn">This conversation contains text that looks like instructions to an assistant ({data.summary.flags.map(label).join(', ')}). Onyx ignores it.</p>}</div>
      <ol className="rev-thread">{data.messages.map(m => <li key={m.id} className={m.direction}>
        <small>{m.direction === 'inbound' ? m.from_email : `To ${m.to_email}`} · {when(m.occurred_at)} · <Status status={m.status}/></small>
        <pre className={m.untrusted ? 'rev-untrusted' : undefined}>{m.body}</pre>
      </li>)}</ol>
      {data.comments.length > 0 && <><h3>Internal comments</h3><ul className="rev-list">{data.comments.map(c => <li key={c.id}><span>{c.body} <small>{since(c.created_at)}</small></span></li>)}</ul></>}
    </>}
    {s.canEdit && <>
      {draft ? <div className="rev-form">
        <p className="rev-muted">Draft by Onyx from this conversation{draft.context_used.length ? ` and ${draft.context_used.join(', ')}` : ''}. Edit freely — it is not sent until approved.</p>
        {draft.flags.length > 0 && <p className="rev-warn">Check carefully: {draft.flags.join('; ')}</p>}
        <label>Subject<input value={draft.subject} onChange={e => setDraft({...draft, subject: e.target.value})}/></label>
        <label>Reply<textarea rows={8} value={draft.body} onChange={e => setDraft({...draft, body: e.target.value})}/></label>
        <div className="rev-actions"><button type="button" className="primary" disabled={s.busy} onClick={() => void saveDraft()}>Save draft for approval</button><button type="button" onClick={() => { setDraft(null); void t('release'); }}>Discard</button></div>
      </div> : <div className="rev-actions"><button type="button" className="primary" disabled={s.busy} onClick={() => void makeDraft()}>Draft a reply with Onyx</button><button type="button" disabled={s.busy} onClick={() => void t('close', {}, 'Conversation closed.')}>Close conversation</button></div>}
      <form className="rev-form" onSubmit={async e => { e.preventDefault(); if (await t('comment', {body: comment}, 'Comment added.')) { setComment(''); void reload(); } }}>
        <label>Internal comment (not sent)<input value={comment} onChange={e => setComment(e.target.value)} required maxLength={2000}/></label>
        <button type="submit" disabled={s.busy}>Add comment</button>
      </form>
    </>}
  </section>;
}

// ---------- Automation ----------
function Automation(s: Shared) {
  const [job, setJob] = useState(s.focus.job);
  const {data, loading, reload, at} = useLoad<{jobs: Json[]; workflows: Json[]; controls: Json | null; runs: Json[] | null}>(s, 'automation', job ? {job} : {});
  if (!data) return <Heading title="Automation" loading={loading}/>;
  const c = data.controls;
  const paused = Boolean(c?.automation_paused);
  return <>
    <Heading title="Automation" sub="Durable jobs with retries. Failed jobs stop in “dead” with their error, and can be replayed once the cause is fixed." onRefresh={reload} loading={loading} at={at}>
      {s.isOwner && <button type="button" className={paused ? 'primary' : undefined} disabled={s.busy} onClick={() => { const r = paused ? null : window.prompt('Why pause automation?'); if (paused || r) void s.act('revenue_set_controls', {p_paused: !paused, p_reason: r, p_daily_send_limit: c?.daily_send_limit ?? null, p_daily_spend_limit_cents: c?.daily_spend_limit_cents ?? null}, paused ? 'Automation resumed.' : 'Automation paused. No jobs will run until resumed.'); }}>{paused ? 'Resume automation' : 'Pause all automation'}</button>}
    </Heading>
    {paused && <div className="rev-alert" role="status">Automation is paused{c?.pause_reason ? `: ${c.pause_reason}` : ''} (since {when(c?.paused_at)}).</div>}
    <div className="rev-grid">
      <section className="rev-panel" aria-labelledby="wf-h"><h2 id="wf-h">Workflows</h2>
        <ul className="rev-list">{data.workflows.map(w => <li key={w.key}><div><strong>{label(w.key)}</strong><small>{w.enabled ? 'On' : 'Off'} · {w.auto_send_authorized ? `sends without review (authorized ${when(w.authorized_at)})` : 'drafts for review'}</small></div>
          {s.isOwner && <button type="button" disabled={s.busy} onClick={() => void s.act('revenue_set_workflow', {p_key: w.key, p_enabled: !w.enabled, p_auto_send: w.auto_send_authorized, p_settings: w.settings}, 'Workflow updated.')}>{w.enabled ? 'Turn off' : 'Turn on'}</button>}</li>)}</ul>
        <p className="rev-muted">Daily send limit: {c?.daily_send_limit ?? 'not set'} · daily spend limit: {c?.daily_spend_limit_cents != null ? money(c.daily_spend_limit_cents) : 'not set'}</p>
      </section>
      <section className="rev-panel" aria-labelledby="runs-h"><h2 id="runs-h">Run history</h2>
        {data.runs ? <ol className="rev-list">{data.runs.map((r, i) => <li key={i}><span>Attempt {r.attempt} on {r.worker}: <strong>{r.outcome ?? 'running'}</strong> · {when(r.started_at)}{r.error ? ` — ${r.error}` : ''}</span></li>)}</ol> : <Empty>Choose a job to see each attempt.</Empty>}
      </section>
    </div>
    <div className="rev-table-wrap"><table className="rev-table">
      <thead><tr><th scope="col">Job</th><th scope="col">Status</th><th scope="col">Attempts</th><th scope="col">Next run / finished</th><th scope="col">Error</th><th scope="col">Actions</th></tr></thead>
      <tbody>{data.jobs.map(j => <tr key={j.id} className={job === j.id ? 'rev-focus' : undefined}>
        <td><button type="button" className="rev-link" onClick={() => setJob(j.id)}>{label(j.kind)}</button>{j.workflow_key ? <small> · {label(j.workflow_key)}</small> : null}</td>
        <td><span className={`rev-status tone-${j.status === 'dead' ? 'bad' : j.status === 'succeeded' ? 'good' : 'neutral'}`}>{label(j.status)}</span>{j.cancel_reason ? <small> ({label(j.cancel_reason)})</small> : null}</td>
        <td>{j.attempts}/{j.max_attempts}</td><td>{when(j.finished_at ?? j.run_at)}</td><td>{j.last_error ?? ''}</td>
        <td>{s.canEdit && <div className="rev-actions">
          {j.status === 'dead' && <button type="button" disabled={s.busy} onClick={() => void s.act('revenue_job_action', {p_job: j.id, p_action: 'replay', p_reason: 'replayed from Revenue'}, 'Job queued again.')}>Replay</button>}
          {['queued', 'running'].includes(j.status) && <button type="button" disabled={s.busy} onClick={() => void s.act('revenue_job_action', {p_job: j.id, p_action: 'cancel', p_reason: 'cancelled from Revenue'}, 'Job cancelled.')}>Cancel</button>}
        </div>}</td>
      </tr>)}</tbody>
    </table>{!data.jobs.length && <Empty>No jobs yet.</Empty>}</div>
  </>;
}

// ---------- Identity reviews ----------
function Reviews(s: Shared) {
  const {data, loading, reload, at} = useLoad<{reviews: Json[]; customers: Json[]}>(s, 'reviews');
  const merges = useLoad<{merges?: Json[]}>(s, 'integrations');
  if (!data) return <Heading title="Identity reviews" loading={loading}/>;
  const who = (id: string) => data.customers.find(c => c.id === id);
  const card = (c: Json | undefined) => c ? <div className="rev-person"><strong>{c.company || c.name}</strong><span>{c.name}</span><small>{c.email ?? 'no email'} · {c.phone || 'no phone'} · {label(c.source)} · added {when(c.created_at)}</small></div> : <div className="rev-person">Unknown record</div>;
  return <>
    <Heading title="Identity reviews" sub="Possible duplicates that need a person to decide. Merges keep every message and event, and can be undone below." onRefresh={reload} loading={loading} at={at}/>
    {data.reviews.map(r => <section key={r.id} className="rev-panel" aria-label={`Review: ${label(r.reason)}`}>
      <h2>{label(r.reason)}</h2>
      <p className="rev-muted">Matched on {Object.entries(r.evidence ?? {}).map(([k, v]) => `${k}: ${String(v)}`).join(', ') || 'similar details'} · {since(r.created_at)}</p>
      <div className="rev-compare">{card(who(r.customer_id))}{r.candidate_ids.map((id: string) => <div key={id}>{card(who(id))}</div>)}</div>
      {s.canEdit && <div className="rev-actions">
        {r.candidate_ids.map((id: string) => <button key={id} type="button" className="primary" disabled={s.busy} onClick={() => void s.act('revenue_resolve_review', {p_review: r.id, p_decision: 'merge', p_survivor: id}, 'Merged. History from both records is kept.')}>Merge into {who(id)?.company || who(id)?.name || 'existing record'}</button>)}
        <button type="button" disabled={s.busy} onClick={() => void s.act('revenue_resolve_review', {p_review: r.id, p_decision: 'distinct', p_survivor: null}, 'Marked as different customers.')}>They are different</button>
      </div>}
    </section>)}
    {!data.reviews.length && <Empty>No open identity reviews.</Empty>}
    <section className="rev-panel" aria-labelledby="merge-h"><h2 id="merge-h">Recent merges</h2>
      {merges.data?.merges?.length ? <ul className="rev-list">{merges.data.merges.map(m => <li key={m.id}><span>Merged {since(m.merged_at)}{m.reverted_at ? ` · undone ${since(m.reverted_at)}` : ''}</span>
        {s.canEdit && !m.reverted_at && <button type="button" disabled={s.busy} onClick={() => void s.act('revenue_unmerge_customers', {p_merge: m.id}, 'Merge undone. Both customers are separate again.')}>Undo merge</button>}</li>)}</ul> : <Empty>No merges yet.</Empty>}
    </section>
  </>;
}
