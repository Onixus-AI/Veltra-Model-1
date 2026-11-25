import {googleAccessToken, type GoogleCredentials} from '../revenue/google-auth';
import {gmailProvider} from '../revenue/gmail-provider';
import {MailProviderError, addressOf, messageIds, nameOf, type OutboundMail} from '../revenue/mail-provider';

// Live Mail (2026-11): the Gmail-style screen in Workspace reads the real mailbox when a person
// opens it — folders, threads, labels — and sends what that person writes. Nothing here runs on its
// own: every call is one signed-in owner's click. Email content is untrusted and is only displayed.

export const FOLDERS = ['inbox', 'starred', 'sent', 'drafts', 'spam', 'trash', 'all'] as const;
export type Folder = typeof FOLDERS[number];
export const TABS = ['primary', 'promotions', 'social', 'updates'] as const;
export type Tab = typeof TABS[number];
export const THREAD_ACTIONS = ['archive', 'inbox', 'read', 'unread', 'star', 'unstar', 'trash', 'untrash', 'spam', 'notspam'] as const;
export type ThreadAction = typeof THREAD_ACTIONS[number];

const FOLDER_LABEL: Record<Folder, string | null> = {inbox: 'INBOX', starred: 'STARRED', sent: 'SENT', drafts: 'DRAFT', spam: 'SPAM', trash: 'TRASH', all: null};
const TAB_LABEL: Record<Tab, string> = {primary: 'CATEGORY_PERSONAL', promotions: 'CATEGORY_PROMOTIONS', social: 'CATEGORY_SOCIAL', updates: 'CATEGORY_UPDATES'};
/** Gmail ids (threads, messages, labels, attachments) are opaque url-safe tokens. */
export const gmailId = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && /^[A-Za-z0-9_-]+$/.test(v);

export type Row = {id: string; from: string; fromName: string; subject: string; snippet: string; at: string; unread: boolean; starred: boolean;
  important: boolean; count: number; attachment: boolean; labels: string[]; sent: boolean};
export type ThreadMessage = {id: string; from: string; fromName: string; to: string; cc: string; at: string; subject: string; text: string; html: string | null;
  messageIdHeader: string | null; references: string | null; unread: boolean; attachments: {id: string; filename: string; mimeType: string; size: number}[]};
export type ThreadView = {id: string; subject: string; labels: string[]; starred: boolean; messages: ThreadMessage[]};
export type Label = {id: string; name: string; unread: number; type: 'system' | 'user'};

type Header = {name: string; value: string};
type Part = {mimeType?: string; filename?: string; headers?: Header[]; body?: {data?: string; size?: number; attachmentId?: string}; parts?: Part[]};
type GmailMsg = {id: string; threadId: string; labelIds?: string[]; snippet?: string; internalDate?: string; payload?: Part};

const decode = (data?: string) => (data ? Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8') : '');
const header = (p: Part | undefined, n: string) => p?.headers?.find(h => h.name.toLowerCase() === n)?.value ?? '';
function firstOf(part: Part | undefined, type: string): string {
  if (!part) return '';
  if (part.mimeType === type && part.body?.data && !part.filename) return decode(part.body.data);
  for (const p of part.parts ?? []) { const found = firstOf(p, type); if (found) return found; }
  return '';
}
function attachmentsOf(part: Part | undefined, out: ThreadMessage['attachments'] = []) {
  if (!part) return out;
  if (part.filename && part.body?.attachmentId) out.push({id: part.body.attachmentId, filename: part.filename.slice(0, 200), mimeType: part.mimeType ?? 'application/octet-stream', size: part.body.size ?? 0});
  for (const p of part.parts ?? []) attachmentsOf(p, out);
  return out;
}
/** Email HTML is untrusted. The screen shows it in a sandboxed frame with scripts off; this also drops active content first. */
export function cleanHtml(html: string): string {
  return html.slice(0, 400_000)
    // Elements whose content must go with them, then any stray opening or closing tag of the same kinds.
    .replace(/<(script|iframe|object|embed|frameset|applet|noscript|template|form|select|textarea)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<\/?(script|iframe|object|embed|frame|frameset|applet|meta|base|link|form|input|button|select|textarea|noscript|template)\b[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1="#"');
}
const iso = (ms?: string) => new Date(Number(ms ?? 0)).toISOString();

export function toRow(t: {id: string; snippet?: string; messages?: GmailMsg[]}, mailbox: string): Row {
  const msgs = t.messages ?? [];
  const last = msgs[msgs.length - 1];
  // Like Gmail: the row names the latest person who wrote, not the mailbox owner, when there is one.
  const latestOther = [...msgs].reverse().find(m => addressOf(header(m.payload, 'from')) !== mailbox.toLowerCase());
  const shown = latestOther ?? last;
  const labels = [...new Set(msgs.flatMap(m => m.labelIds ?? []))];
  const fromHeader = header(shown?.payload, 'from');
  return {id: t.id, from: addressOf(fromHeader), fromName: nameOf(fromHeader) || addressOf(fromHeader), subject: header(msgs[0]?.payload, 'subject') || '(no subject)',
    snippet: decodeEntities(t.snippet ?? last?.snippet ?? ''), at: iso(last?.internalDate), unread: msgs.some(m => (m.labelIds ?? []).includes('UNREAD')),
    starred: labels.includes('STARRED'), important: labels.includes('IMPORTANT'), count: msgs.length,
    attachment: msgs.some(m => m.payload?.mimeType === 'multipart/mixed'), labels, sent: !latestOther};
}
const decodeEntities = (s: string) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

export function toThread(t: {id: string; messages?: GmailMsg[]}): ThreadView {
  const msgs = t.messages ?? [];
  const labels = [...new Set(msgs.flatMap(m => m.labelIds ?? []))];
  return {id: t.id, subject: header(msgs[0]?.payload, 'subject') || '(no subject)', labels, starred: labels.includes('STARRED'),
    messages: msgs.filter(m => !(m.labelIds ?? []).includes('DRAFT') || msgs.length === 1).map(m => {
      const from = header(m.payload, 'from');
      const html = firstOf(m.payload, 'text/html');
      return {id: m.id, from: addressOf(from), fromName: nameOf(from) || addressOf(from), to: header(m.payload, 'to'), cc: header(m.payload, 'cc'), at: iso(m.internalDate),
        subject: header(m.payload, 'subject'), text: firstOf(m.payload, 'text/plain').slice(0, 200_000) || (m.snippet ?? ''), html: html ? cleanHtml(html) : null,
        messageIdHeader: messageIds(header(m.payload, 'message-id'))[0] ?? null, references: messageIds(header(m.payload, 'references')).join(' ') || null,
        unread: (m.labelIds ?? []).includes('UNREAD'), attachments: attachmentsOf(m.payload)};
    })};
}

/** Label changes per action, applied to the whole thread (as Gmail does). Trash moves are recoverable for 30 days. */
export function actionChange(a: ThreadAction): {add: string[]; remove: string[]} | 'trash' | 'untrash' {
  switch (a) {
    case 'archive': return {add: [], remove: ['INBOX']};
    case 'inbox': return {add: ['INBOX'], remove: []};
    case 'read': return {add: [], remove: ['UNREAD']};
    case 'unread': return {add: ['UNREAD'], remove: []};
    case 'star': return {add: ['STARRED'], remove: []};
    case 'unstar': return {add: [], remove: ['STARRED']};
    case 'spam': return {add: ['SPAM'], remove: ['INBOX']};
    case 'notspam': return {add: ['INBOX'], remove: ['SPAM']};
    case 'trash': return 'trash';
    case 'untrash': return 'untrash';
  }
}

export function listQuery(o: {folder: Folder; tab?: Tab | null; label?: string | null; q?: string | null; pageToken?: string | null; max?: number}): string {
  const p = new URLSearchParams({maxResults: String(o.max ?? 25)});
  if (o.label) p.append('labelIds', o.label);
  else {
    const folder = FOLDER_LABEL[o.folder];
    if (folder) p.append('labelIds', folder);
    if (o.folder === 'inbox' && o.tab) p.append('labelIds', TAB_LABEL[o.tab]);
  }
  if (o.q?.trim()) p.set('q', o.q.trim().slice(0, 500));
  if (o.folder === 'spam' || o.folder === 'trash') p.set('includeSpamTrash', 'true');
  if (o.pageToken) p.set('pageToken', o.pageToken);
  return p.toString();
}

export type Compose = {idempotencyKey: string; to: string; cc?: string | null; bcc?: string | null; subject: string; body: string;
  threadId?: string | null; inReplyTo?: string | null; references?: string | null};
const ADDRESS = /^[^\s<>@,;"']+@[^\s<>@,;"']+\.[^\s<>@,;"']+$/;
/** A comma-separated list of plain addresses, or null when empty. Throws on anything else. */
export function recipients(v: unknown, field: string, required = false): string | null {
  const list = String(v ?? '').split(/[,;]/).map(s => addressOf(s.trim())).filter(Boolean);
  if (!list.length) { if (required) throw new Error(`400:Add at least one ${field} address.`); return null; }
  if (list.length > 50) throw new Error(`400:Use 50 or fewer ${field} addresses.`);
  const bad = list.find(a => !ADDRESS.test(a));
  if (bad) throw new Error(`400:"${bad.slice(0, 80)}" is not an email address.`);
  return [...new Set(list)].join(', ');
}

export function liveBox(credentials: GoogleCredentials, mailbox: string, o: {fetcher?: typeof fetch; apiUrl?: string; tokenUrl?: string; senderName?: string | null} = {}) {
  const fetcher = o.fetcher ?? fetch;
  const api = (o.apiUrl ?? 'https://gmail.googleapis.com/gmail/v1/users/me').replace(/\/$/, '');
  const token = googleAccessToken(credentials, o);
  async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const r = await fetcher(api + path, {...init, headers: {Authorization: `Bearer ${await token.get()}`, 'Content-Type': 'application/json'}, redirect: 'error', signal: AbortSignal.timeout(20000)});
    if (r.ok) return (r.status === 204 ? {} : await r.json()) as T;
    const detail = await r.json().catch(() => ({})) as {error?: {message?: string}};
    if (r.status === 401) throw new MailProviderError('auth_expired', 'Google connection expired. Reconnect Gmail in Connections.', false);
    if (r.status === 429) throw new MailProviderError('rate_limited', 'Gmail is busy. Try again in a moment.', true);
    if (r.status === 404) throw new MailProviderError('rejected', 'That conversation is no longer in Gmail.', false);
    throw new MailProviderError(r.status >= 500 ? 'temporary' : 'rejected', detail.error?.message?.slice(0, 200) ?? `Gmail returned ${r.status}`, r.status >= 500);
  }
  const me = mailbox.toLowerCase();
  return {
    async list(q: Parameters<typeof listQuery>[0]): Promise<{rows: Row[]; next: string | null; estimate: number}> {
      const page = await call<{threads?: {id: string; snippet?: string}[]; nextPageToken?: string; resultSizeEstimate?: number}>(`/threads?${listQuery(q)}`);
      const meta = 'format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=To';
      const rows = await Promise.all((page.threads ?? []).map(async t => {
        const full = await call<{id: string; messages?: GmailMsg[]}>(`/threads/${t.id}?${meta}`).catch(() => null);
        return full ? toRow({...full, snippet: t.snippet}, me) : null;
      }));
      return {rows: rows.filter((r): r is Row => !!r), next: page.nextPageToken ?? null, estimate: page.resultSizeEstimate ?? 0};
    },
    async thread(id: string): Promise<ThreadView> {
      return toThread(await call<{id: string; messages?: GmailMsg[]}>(`/threads/${id}?format=full`));
    },
    async act(id: string, a: ThreadAction) {
      const change = actionChange(a);
      if (change === 'trash' || change === 'untrash') await call(`/threads/${id}/${change}`, {method: 'POST'});
      else await call(`/threads/${id}/modify`, {method: 'POST', body: JSON.stringify({addLabelIds: change.add, removeLabelIds: change.remove})});
    },
    async labels(): Promise<Label[]> {
      const list = await call<{labels?: {id: string; name: string; type?: string}[]}>('/labels');
      const user = (list.labels ?? []).filter(l => l.type === 'user').sort((a, b) => a.name.localeCompare(b.name)).slice(0, 100);
      const inbox = await call<{threadsUnread?: number}>('/labels/INBOX').catch(() => ({threadsUnread: 0}));
      return [{id: 'INBOX', name: 'Inbox', unread: inbox.threadsUnread ?? 0, type: 'system'}, ...user.map(l => ({id: l.id, name: l.name, unread: 0, type: 'user' as const}))];
    },
    async attachment(messageId: string, attachmentId: string): Promise<Buffer> {
      const a = await call<{data?: string}>(`/messages/${messageId}/attachments/${attachmentId}`);
      return Buffer.from((a.data ?? '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    },
    /** Sends what the signed-in person wrote. A retried click with the same key never sends twice. */
    async send(c: Compose) {
      const provider = gmailProvider(credentials, {fetcher: o.fetcher, apiUrl: o.apiUrl, tokenUrl: o.tokenUrl, fromName: o.senderName});
      const earlier = await provider.findSent?.(c.idempotencyKey);
      if (earlier) return {...earlier, duplicate: true};
      const mail: OutboundMail = {idempotencyKey: c.idempotencyKey, from: me, to: c.to, cc: c.cc ?? null, bcc: c.bcc ?? null, subject: c.subject, body: c.body,
        threadId: c.threadId ?? null, inReplyTo: c.inReplyTo ?? null, references: c.references ?? null};
      return {...await provider.send(mail), duplicate: false};
    },
  };
}
