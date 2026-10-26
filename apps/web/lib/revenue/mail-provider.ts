// One interface for every mailbox. The Gmail adapter, a future Microsoft 365 adapter and the
// hermetic test provider all implement it, so sync and sending code never changes per provider.

export type OutboundMail = {
  idempotencyKey: string;
  from: string; fromName?: string | null; replyTo?: string | null;
  to: string; cc?: string | null; subject: string; body: string;
  threadId?: string | null; inReplyTo?: string | null; references?: string | null;
};

export type ProviderMessage = {
  providerMessageId: string; threadId: string; direction: 'inbound' | 'outbound';
  from: string; fromName: string; to: string; subject: string; text: string; occurredAt: string;
  messageIdHeader: string | null; inReplyTo: string | null; references: string | null; automated: boolean;
  attachments: {filename: string; mimeType: string; size: number}[];
  bounce?: {recipient: string; status: string; diagnostic: string} | null;
};

export type ChangePage = {messages: ProviderMessage[]; cursor: string; more: boolean};

export type MailErrorCode = 'auth_expired' | 'rate_limited' | 'invalid_recipient' | 'cursor_expired' | 'temporary' | 'rejected' | 'provider_unavailable' | 'scope_missing' | 'sender_not_allowed';

export class MailProviderError extends Error {
  constructor(public code: MailErrorCode, message: string, public retryable: boolean) {
    super(message);
  }
}

export interface MailProvider {
  readonly name: string;
  address(): Promise<string>;
  send(mail: OutboundMail): Promise<{providerMessageId: string; providerThreadId: string}>;
  /** Finds a message already sent with this idempotency key (its Message-ID), so a retried job after a crash never sends twice. */
  findSent?(idempotencyKey: string): Promise<{providerMessageId: string; providerThreadId: string} | null>;
  /** Addresses this mailbox may send as (its own plus verified aliases); the provider would otherwise rewrite or reject From. */
  senders?(): Promise<string[]>;
  /** Changes since the cursor; with no cursor, returns the current position and recent messages. */
  changes(cursor: string | null, limit: number): Promise<ChangePage>;
}

const machine = /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|notifications?|bounce|alerts?)([+.@-]|$)/i;
export function isAutomatedSender(address: string, headers: Record<string, string>): boolean {
  const h = (k: string) => headers[k.toLowerCase()] ?? '';
  return machine.test(address.split('@')[0] ?? '') || /auto-(replied|generated)/i.test(h('auto-submitted')) || /bulk|list|junk|auto_reply/i.test(h('precedence')) || Boolean(h('list-id') || h('x-autoreply'));
}

/** DSN (RFC 3464) bounce parsing; the report is untrusted and only marks a message failed. */
export function parseBounce(from: string, text: string): ProviderMessage['bounce'] {
  if (!/^(mailer-daemon|postmaster)@/i.test(from)) return null;
  if (!/(?:^|\n)Action:\s*failed\s*(?:\r?\n|$)/i.test(text)) return null;
  const status = /(?:^|\n)Status:\s*([45]\.\d{1,3}\.\d{1,3})\b/i.exec(text)?.[1];
  const recipients = [...text.matchAll(/(?:^|\n)Final-Recipient:\s*rfc822;\s*([^\s<>;,]+@[^\s<>;,]+)/gi)].map(m => m[1].toLowerCase());
  if (!status || recipients.length !== 1) return null;
  return {recipient: recipients[0], status, diagnostic: /(?:^|\n)Diagnostic-Code:\s*([^\n]{0,300})/i.exec(text)?.[1]?.trim() ?? ''};
}

export const addressOf = (value: string) => (/<([^>]+)>/.exec(value)?.[1] ?? value).trim().toLowerCase();
export const nameOf = (value: string) => value.replace(/<[^>]+>/, '').replace(/"/g, '').trim();

const headerSafe = (v: string) => v.replace(/[\r\n]+/g, ' ').trim();

/** Well-formed <id@domain> msg-ids in a header value, in order and without duplicates; anything else is dropped. */
export function messageIds(value: string | null | undefined): string[] {
  return [...new Set((value ?? '').slice(0, 20000).match(/<[!-;=?-~]+@[!-;=?-~]+>/g) ?? [])].filter(id => id.length <= 250);
}

/** The Message-ID a send carries; retries reuse it, so Gmail search can find an earlier send. */
export const messageIdFor = (idempotencyKey: string) => `<${headerSafe(idempotencyKey)}@onixus.mail>`;

/** In-Reply-To and References for a reply, or nulls (no threading headers) when there is no valid parent id. */
export function threadingHeaders(inReplyTo: string | null | undefined, references?: string | null): {inReplyTo: string | null; references: string[]} {
  const parent = messageIds(inReplyTo)[0] ?? null;
  if (!parent) return {inReplyTo: null, references: []};
  const chain = [...messageIds(references).filter(id => id !== parent), parent];
  return {inReplyTo: parent, references: chain.length <= 20 ? chain : [chain[0], ...chain.slice(-19)]};
}

export const replySubject = (subject: string) => (/^\s*re\s*:/i.test(subject) ? subject : `Re: ${subject}`.trim());

/** RFC 5322 message with threading headers; header injection is prevented by stripping CR/LF. */
export function buildMime(m: OutboundMail, now = new Date()): string {
  const from = m.fromName ? `"${headerSafe(m.fromName).replace(/"/g, '')}" <${headerSafe(m.from)}>` : headerSafe(m.from);
  const thread = threadingHeaders(m.inReplyTo, m.references);
  const subject = thread.inReplyTo ? replySubject(m.subject) : m.subject;
  const encodedSubject = /^[\x20-\x7e]*$/.test(subject) ? headerSafe(subject) : `=?UTF-8?B?${Buffer.from(headerSafe(subject)).toString('base64')}?=`;
  const lines = [
    `From: ${from}`, `To: ${headerSafe(m.to)}`, ...(m.cc ? [`Cc: ${headerSafe(m.cc)}`] : []),
    ...(m.replyTo ? [`Reply-To: ${headerSafe(m.replyTo)}`] : []),
    `Subject: ${encodedSubject}`, `Date: ${now.toUTCString()}`,
    `Message-ID: ${messageIdFor(m.idempotencyKey)}`,
    // References is folded one id per line so long chains stay under the 998-character line limit.
    ...(thread.inReplyTo ? [`In-Reply-To: ${thread.inReplyTo}`, `References: ${thread.references.join('\r\n ')}`] : []),
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '',
    Buffer.from(m.body).toString('base64').replace(/.{76}/g, '$&\r\n'),
  ];
  return lines.join('\r\n');
}
