import {NextRequest} from 'next/server';
import {createClient} from '@supabase/supabase-js';
import {crmUser, crmError} from '@/lib/crm/server';
import {googleClient} from '@/lib/mail/workspace-mail';
import {FOLDERS, TABS, THREAD_ACTIONS, gmailId, liveBox, recipients, type Folder, type Tab, type ThreadAction} from '@/lib/mail/live-box';
import {MailProviderError} from '@/lib/revenue/mail-provider';
export const runtime = 'nodejs';
export const maxDuration = 30;

// Live Mail: the Gmail-style screen in Workspace. Every call is the signed-in owner's own click.
// The mailbox's Google access is released to this server only (service-role RPC that re-checks
// ownership), never to the browser. Email content is untrusted and only displayed or sent as written.

const UUID = /^[a-f0-9-]{36}$/i;
type Access = {account_id: string; mailbox: string; sender_name: string | null; mailboxes: string[]; refresh_token: string};

async function open(request: NextRequest, workspaceParam: unknown, mailboxParam: unknown) {
  const {client, user} = await crmUser(request);
  let workspace = typeof workspaceParam === 'string' && UUID.test(workspaceParam) ? workspaceParam : null;
  if (!workspace) {
    const {data, error} = await client.rpc('mail_google_home');
    if (error) throw new Error(error.message);
    workspace = (data as string | null) ?? null;
  }
  if (!workspace) throw new Error('409:This login is not part of a business yet. Sign in as the business owner to open Mail.');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY, google = googleClient();
  if (!url || !key || !google) throw new Error('503:Mail is not configured on this server.');
  const mailbox = typeof mailboxParam === 'string' && mailboxParam.length <= 320 ? mailboxParam : null;
  const admin = createClient(url, key, {auth: {persistSession: false, autoRefreshToken: false}});
  const {data, error} = await admin.rpc('mail_live_access', {p_user: user.id, p_workspace: workspace, p_mailbox: mailbox});
  if (error) throw new Error(/^\d{3}:/.test(error.message) ? error.message : '502:Mail could not open this mailbox.');
  const access = data as Access;
  const box = liveBox({clientId: google.clientId, clientSecret: google.clientSecret, refreshToken: access.refresh_token}, access.mailbox, {senderName: access.sender_name});
  return {client, workspace, access, box};
}

function fail(e: unknown) {
  if (e instanceof MailProviderError) {
    const status = e.code === 'rate_limited' ? 429 : e.code === 'auth_expired' ? 409 : e.code === 'rejected' ? 422 : 502;
    return Response.json({error: e.message}, {status, headers: {'Cache-Control': 'no-store'}});
  }
  return crmError(e);
}
const json = (body: unknown) => Response.json(body, {headers: {'Cache-Control': 'no-store'}});

type CrmClient = Awaited<ReturnType<typeof crmUser>>['client'];
const OUTCOMES = ['won', 'lost', 'pending', 'declined', 'unknown'] as const;
const text = (v: unknown, max: number) => typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

// Addresses on the thread other than the mailbox itself: the CRM matches the sender on these.
function threadEmails(thread: {messages: {from: string; to: string; cc: string}[]}, mailbox: string) {
  const own = mailbox.toLowerCase(), found = new Set<string>();
  for (const m of thread.messages) for (const a of `${m.from} ${m.to} ${m.cc}`.match(/[^\s<>,;"']+@[^\s<>,;"']+/g) ?? []) {
    if (a.toLowerCase() !== own) found.add(a.toLowerCase());
  }
  return [...found].slice(0, 50);
}

// The CRM strip is extra: if the CRM cannot answer, the owner still reads and sends mail.
async function crmFor(client: CrmClient, workspace: string, account: string, mailbox: string, thread: {id: string; messages: {from: string; to: string; cc: string}[]}) {
  const {data, error} = await client.rpc('mail_thread_crm_context', {p_workspace: workspace, p_account: account, p_thread_id: thread.id, p_emails: threadEmails(thread, mailbox)});
  if (error) { console.warn('CRM context unavailable:', error.message); return {unavailable: true}; }
  return data;
}

export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  try {
    const {client, workspace, access, box} = await open(request, p.get('workspace'), p.get('mailbox'));
    const action = p.get('action') ?? 'list';
    const me = {workspace_id: workspace, mailbox: access.mailbox, mailboxes: access.mailboxes};
    if (action === 'labels') return json({...me, labels: await box.labels()});
    if (action === 'list') {
      const folder = (FOLDERS as readonly string[]).includes(p.get('folder') ?? '') ? p.get('folder') as Folder : 'inbox';
      const tab = (TABS as readonly string[]).includes(p.get('tab') ?? '') ? p.get('tab') as Tab : null;
      const label = p.get('label'), page = p.get('page');
      if (label && !gmailId(label)) return Response.json({error: 'Unknown label.'}, {status: 400});
      if (page && (page.length > 200 || !/^[A-Za-z0-9_-]+$/.test(page))) return Response.json({error: 'Unknown page.'}, {status: 400});
      return json({...me, ...await box.list({folder, tab, label, q: p.get('q'), pageToken: page})});
    }
    if (action === 'thread') {
      const id = p.get('id');
      if (!gmailId(id)) return Response.json({error: 'Unknown conversation.'}, {status: 400});
      const thread = await box.thread(id);
      return json({...me, thread, crm: await crmFor(client, workspace, access.account_id, access.mailbox, thread)});
    }
    if (action === 'attachment') {
      const message = p.get('message'), attachment = p.get('attachment');
      if (!gmailId(message) || !gmailId(attachment, 2000)) return Response.json({error: 'Unknown attachment.'}, {status: 400});
      const name = (p.get('name') ?? 'attachment').replace(/[^\w.() -]+/g, '_').slice(0, 150) || 'attachment';
      const bytes = await box.attachment(message, attachment);
      // Always a download, never rendered here: attachments are untrusted.
      return new Response(new Uint8Array(bytes), {headers: {'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${name}"`,
        'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store'}});
    }
    if (action === 'work') {
      // What the Mail employee sorted for this mailbox: waiting for the owner, or already handled.
      const status = p.get('status') === 'done' ? 'done' : 'pending';
      const {data, error} = await client.rpc('mail_items_list', {p_workspace: workspace, p_status: status});
      if (error) throw new Error(error.message);
      const items = (data as Record<string, unknown>[]).filter(i => i.account_id === access.account_id).map(i => ({
        id: i.id, thread_id: i.thread_id, provider_message_id: i.provider_message_id, from_email: i.from_email, from_name: i.from_name, subject: i.subject,
        category: i.category, summary: i.summary, priority: i.priority, needs_owner: i.needs_owner, owner_reason: i.owner_reason, plan: i.plan, draft: i.draft,
        status: i.status, created_at: i.created_at}));
      return json({...me, items});
    }
    return Response.json({error: 'Unknown action.'}, {status: 400});
  } catch (e) { return fail(e); }
}

export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (raw.length > 250_000) return Response.json({error: 'That message is too long.'}, {status: 413});
  let b: Record<string, unknown>;
  try { b = JSON.parse(raw); } catch { return Response.json({error: 'Invalid request.'}, {status: 400}); }
  try {
    const {client, workspace, access, box} = await open(request, b.workspace, b.mailbox);
    if (b.action === 'act') {
      const ids = Array.isArray(b.ids) ? b.ids : [b.id];
      if (!ids.length || ids.length > 50 || !ids.every(id => gmailId(id))) return Response.json({error: 'Choose up to 50 conversations.'}, {status: 400});
      if (!(THREAD_ACTIONS as readonly string[]).includes(String(b.op))) return Response.json({error: 'Unknown action.'}, {status: 400});
      for (const id of ids as string[]) await box.act(id, b.op as ThreadAction);
      return json({done: ids.length});
    }
    if (b.action === 'send') {
      if (typeof b.key !== 'string' || !UUID.test(b.key)) return Response.json({error: 'Invalid send key.'}, {status: 400});
      const subject = String(b.subject ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 900);
      const body = String(b.body ?? '');
      if (!body.trim() && !subject) return Response.json({error: 'Write a subject or a message first.'}, {status: 400});
      if (body.length > 200_000) return Response.json({error: 'That message is too long.'}, {status: 413});
      if (b.thread_id != null && !gmailId(b.thread_id)) return Response.json({error: 'Unknown conversation.'}, {status: 400});
      const sent = await box.send({idempotencyKey: b.key, to: recipients(b.to, 'To', true)!, cc: recipients(b.cc, 'Cc'), bcc: recipients(b.bcc, 'Bcc'),
        subject: subject || '(no subject)', body, threadId: (b.thread_id as string | undefined) ?? null,
        inReplyTo: typeof b.in_reply_to === 'string' ? b.in_reply_to.slice(0, 1000) : null, references: typeof b.references === 'string' ? b.references.slice(0, 20000) : null});
      return json({sent: true, id: sent.providerMessageId, thread_id: sent.providerThreadId, duplicate: sent.duplicate});
    }
    if (b.action === 'crm_link' || b.action === 'crm_outcome' || b.action === 'crm_task') {
      // The CRM writes go through the same owner-checked functions the migration defines; the browser sends intent only.
      if (!(typeof b.thread_id === 'string' && gmailId(b.thread_id))) return Response.json({error: 'Unknown conversation.'}, {status: 400});
      const thread = b.thread_id as string, account = access.account_id, subject = text(b.subject, 500) ?? '(no subject)';
      if (b.action === 'crm_link') {
        if (b.customer_id != null && !(typeof b.customer_id === 'string' && UUID.test(b.customer_id))) return Response.json({error: 'Choose a valid customer.'}, {status: 400});
        const {data, error} = await client.rpc('mail_thread_link_customer', {p_workspace: workspace, p_account: account, p_thread_id: thread, p_subject: subject,
          p_customer_id: (b.customer_id as string | undefined) ?? null, p_company: text(b.company, 200), p_email: text(b.email, 320)});
        if (error) throw new Error(error.message);
        return json(data);
      }
      if (b.action === 'crm_outcome') {
        if (!(OUTCOMES as readonly string[]).includes(String(b.status))) return Response.json({error: 'Choose a quote outcome.'}, {status: 400});
        const {data, error} = await client.rpc('mail_thread_log_quote_outcome', {p_workspace: workspace, p_account: account, p_thread_id: thread, p_subject: subject,
          p_status: b.status, p_reason: text(b.reason, 300) ?? '', p_evidence: text(b.evidence, 2000) ?? '', p_source_message_id: null});
        if (error) throw new Error(error.message);
        return json(data);
      }
      if (!(typeof b.customer_id === 'string' && UUID.test(b.customer_id))) return Response.json({error: 'Link a CRM customer before creating a follow-up task.'}, {status: 400});
      const due = typeof b.due_at === 'string' && Number.isFinite(Date.parse(b.due_at)) ? new Date(b.due_at).toISOString() : null;
      const {data, error} = await client.rpc('mail_thread_create_task', {p_workspace: workspace, p_account: account, p_thread_id: thread, p_customer_id: b.customer_id,
        p_title: text(b.title, 300) ?? '', p_due_at: due, p_action_key: null});
      if (error) throw new Error(error.message);
      return json(data);
    }
    if (b.action === 'decide') {
      // The owner approves or skips what the Mail employee planned; the database re-checks every rule.
      if (typeof b.id !== 'string' || !UUID.test(b.id) || !['approve', 'skip'].includes(String(b.decision))) return Response.json({error: 'Invalid decision.'}, {status: 400});
      const draft = typeof b.draft === 'string' ? b.draft : null;
      const {data, error} = await client.rpc('mail_item_decide', {p_workspace: workspace, p_id: b.id, p_decision: b.decision, p_draft: draft});
      if (error) throw new Error(error.message);
      return json(data);
    }
    return Response.json({error: 'Unknown action.'}, {status: 400});
  } catch (e) { return fail(e); }
}
