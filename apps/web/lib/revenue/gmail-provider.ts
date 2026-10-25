import {buildMime, isAutomatedSender, MailProviderError, addressOf, nameOf, parseBounce, type ChangePage, type MailProvider, type OutboundMail, type ProviderMessage} from './mail-provider';
import {googleAccessToken, type GoogleCredentials} from './google-auth';

// Gmail REST adapter: users.messages.send for sending, users.history.list for incremental
// two-way sync. Uses the existing Onixus Mail OAuth client and refresh token (scopes
// gmail.modify + gmail.send, already granted). Tokens are supplied by the caller and never logged.

type Part = {mimeType?: string; filename?: string; body?: {data?: string; size?: number; attachmentId?: string}; parts?: Part[]; headers?: {name: string; value: string}[]};
type GmailMessage = {id: string; threadId: string; labelIds?: string[]; internalDate: string; payload: Part};

export type GmailCredentials = GoogleCredentials;

const decode = (data?: string) => (data ? Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8') : '');
function textOf(part: Part): string {
  if (part.mimeType === 'text/plain' && part.body?.data) return decode(part.body.data);
  for (const p of part.parts ?? []) { const t = textOf(p); if (t) return t; }
  if (part.mimeType === 'text/html' && part.body?.data) return decode(part.body.data).replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|tr)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
  return '';
}
function attachmentsOf(part: Part, out: ProviderMessage['attachments'] = []) {
  if (part.filename && part.body?.attachmentId) out.push({filename: part.filename.slice(0, 200), mimeType: part.mimeType ?? 'application/octet-stream', size: part.body.size ?? 0});
  for (const p of part.parts ?? []) attachmentsOf(p, out);
  return out;
}

export function toProviderMessage(m: GmailMessage, mailbox: string): ProviderMessage {
  const headers: Record<string, string> = {};
  for (const h of m.payload.headers ?? []) headers[h.name.toLowerCase()] = h.value;
  const from = headers.from ?? '';
  const fromAddress = addressOf(from);
  const text = textOf(m.payload).slice(0, 100_000);
  const outbound = (m.labelIds ?? []).includes('SENT') || fromAddress === mailbox.toLowerCase();
  return {
    providerMessageId: m.id, threadId: m.threadId, direction: outbound ? 'outbound' : 'inbound',
    from: fromAddress, fromName: nameOf(from), to: addressOf(headers.to ?? ''), subject: headers.subject ?? '(no subject)', text,
    occurredAt: new Date(Number(m.internalDate)).toISOString(), messageIdHeader: headers['message-id'] ?? null, inReplyTo: headers['in-reply-to'] ?? null,
    automated: isAutomatedSender(fromAddress, headers), attachments: attachmentsOf(m.payload), bounce: parseBounce(fromAddress, text),
  };
}

export function gmailProvider(credentials: GmailCredentials, o: {fetcher?: typeof fetch; apiUrl?: string; tokenUrl?: string} = {}): MailProvider {
  const fetcher = o.fetcher ?? fetch;
  const api = (o.apiUrl ?? 'https://gmail.googleapis.com/gmail/v1/users/me').replace(/\/$/, '');
  const token = googleAccessToken(credentials, o);
  let mailbox: string | null = null;

  async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetcher(api + path, {...init, headers: {...(init.headers ?? {}), Authorization: `Bearer ${await token.get()}`, 'Content-Type': 'application/json'}, signal: AbortSignal.timeout(20000)});
    if (response.ok) return response.json() as Promise<T>;
    const detail = await response.json().catch(() => ({})) as {error?: {message?: string; status?: string}};
    const message = detail.error?.message?.slice(0, 200) ?? `Gmail returned ${response.status}`;
    if (response.status === 401) { token.reset(); throw new MailProviderError('auth_expired', 'Google connection expired. Reconnect Google in Onixus Mail.', false); }
    if (response.status === 404 && path.startsWith('/history')) throw new MailProviderError('cursor_expired', 'Gmail sync position expired; a recent-mail resync is required.', true);
    if (response.status === 429 || (response.status === 403 && /rate|quota/i.test(message))) throw new MailProviderError('rate_limited', 'Gmail rate limit reached; retrying later.', true);
    if (response.status === 400 && /recipient|address|invalid to/i.test(message)) throw new MailProviderError('invalid_recipient', message, false);
    if (response.status >= 500) throw new MailProviderError('temporary', 'Gmail is temporarily unavailable.', true);
    throw new MailProviderError('rejected', message, false);
  }

  async function address() {
    mailbox ??= (await call<{emailAddress: string; historyId: string}>('/profile')).emailAddress.toLowerCase();
    return mailbox;
  }

  return {
    name: 'Gmail',
    address,
    async send(mail: OutboundMail) {
      const raw = Buffer.from(buildMime(mail)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const sent = await call<{id: string; threadId: string}>('/messages/send', {method: 'POST', body: JSON.stringify({raw, ...(mail.threadId ? {threadId: mail.threadId} : {})})});
      return {providerMessageId: sent.id, providerThreadId: sent.threadId};
    },
    async senders() {
      const me = await address();
      const list = await call<{sendAs?: {sendAsEmail: string; isPrimary?: boolean; verificationStatus?: string}[]}>('/settings/sendAs');
      return [...new Set([me, ...(list.sendAs ?? []).filter(s => s.isPrimary || s.verificationStatus === 'accepted').map(s => s.sendAsEmail.toLowerCase())])];
    },
    async findSent(idempotencyKey: string) {
      const found = await call<{messages?: {id: string; threadId: string}[]}>(`/messages?maxResults=1&q=${encodeURIComponent(`in:sent rfc822msgid:${idempotencyKey}@onixus.mail`)}`);
      const m = found.messages?.[0];
      return m ? {providerMessageId: m.id, providerThreadId: m.threadId} : null;
    },
    async changes(cursor: string | null, limit: number): Promise<ChangePage> {
      const me = await address();
      if (!cursor) {
        const profile = await call<{historyId: string}>('/profile');
        const recent = await call<{messages?: {id: string}[]}>(`/messages?maxResults=${Math.min(limit, 50)}&q=${encodeURIComponent('newer_than:7d -in:chats')}`);
        const messages = await Promise.all((recent.messages ?? []).map(m => call<GmailMessage>(`/messages/${m.id}?format=full`)));
        return {messages: messages.map(m => toProviderMessage(m, me)).reverse(), cursor: profile.historyId, more: false};
      }
      const page = await call<{history?: {id: string; messagesAdded?: {message: {id: string}}[]}[]; historyId: string; nextPageToken?: string}>(
        `/history?startHistoryId=${encodeURIComponent(cursor)}&historyTypes=messageAdded&maxResults=${Math.min(limit, 100)}`);
      const ids = [...new Set((page.history ?? []).flatMap(h => (h.messagesAdded ?? []).map(a => a.message.id)))];
      const messages: ProviderMessage[] = [];
      for (const id of ids) {
        try { messages.push(toProviderMessage(await call<GmailMessage>(`/messages/${id}?format=full`), me)); }
        catch (e) { if (!(e instanceof MailProviderError && e.code === 'rejected')) throw e; }
      }
      // With more pages, resume after the last history record processed rather than skipping ahead.
      const last = (page.history ?? []).map(h => Number(h.id)).reduce((a, b) => Math.max(a, b), Number(cursor));
      return {messages, cursor: page.nextPageToken ? last.toString() : page.historyId, more: Boolean(page.nextPageToken)};
    },
  };
}
