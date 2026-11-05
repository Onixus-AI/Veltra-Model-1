import {MailProviderError, type MailProvider, type ProviderMessage} from './mail-provider';
import {analyzeMessage} from './untrusted';
import {RevenueError} from './errors';

export type MailIngest = (event: Record<string, unknown>) => Promise<unknown>;
export type SyncResult = {status: 'healthy' | 'expired' | 'error'; cursor: string | null; ingested: number; skipped?: {provider_message_id: string; reason: string}[]; error?: string; detail?: string};

export function toIngestEvent(m: ProviderMessage): Record<string, unknown> {
  if (m.bounce) return {type: 'message.bounced', recipient: m.bounce.recipient, status: m.bounce.status, diagnostic: m.bounce.diagnostic, occurred_at: m.occurredAt};
  const common = {provider_message_id: m.providerMessageId, thread_id: m.threadId, to: m.to, from_email: m.from, subject: m.subject.slice(0, 500), text: m.text, occurred_at: m.occurredAt,
    message_id_header: m.messageIdHeader, in_reply_to: m.inReplyTo, references: m.references};
  if (m.direction === 'outbound') return {type: 'message.outbound_observed', ...common};
  const analysis = analyzeMessage(m.text);
  return {type: 'message.inbound', ...common, from_name: m.fromName, automated: m.automated, attachments: m.attachments,
    analysis: {questions: analysis.questions, injection_flags: analysis.injection.map(f => f.kind)}};
}

/**
 * Two-way sync pass. The cursor only advances after every message in the page was ingested, so a
 * failure mid-page is retried from the same position; ingestion is idempotent per provider id.
 */
export type SyncOptions = {
  limit?: number; maxPages?: number;
  /** Save the position after every page, so a catch-up interrupted by a rate limit or a time limit resumes where it stopped. */
  checkpoint?: boolean;
  /** Stop starting new pages after this time (ms since epoch); the saved position carries on next pass. */
  deadline?: number;
  /** Sees each message after it is recorded (Mail's employee notes new inbound mail to sort). */
  onMessage?: (m: ProviderMessage) => void;
};

export async function syncMailbox(o: {provider: MailProvider; cursor: string | null; ingest: MailIngest} & SyncOptions): Promise<SyncResult> {
  let cursor = o.cursor, ingested = 0, reported = 0, saved = o.cursor, mailbox: string | undefined;
  const skipped: {provider_message_id: string; reason: string}[] = [];
  try {
    mailbox = await o.provider.address();
    for (let page = 0; page < (o.maxPages ?? 5); page++) {
      let changes;
      try {
        changes = await o.provider.changes(cursor, o.limit ?? 50);
      } catch (e) {
        if (e instanceof MailProviderError && e.code === 'cursor_expired' && cursor) {
          cursor = null;
          changes = await o.provider.changes(null, o.limit ?? 50);
        } else throw e;
      }
      for (const m of changes.messages) {
        try {
          await o.ingest(toIngestEvent(m));
          ingested++;
          o.onMessage?.(m);
        } catch (e) {
          // A message the database rejects as invalid would otherwise block the mailbox forever;
          // transient failures still stop the pass so the page is retried from the same cursor.
          if (!(e instanceof RevenueError && (e.status === 400 || e.status === 409))) throw e;
          skipped.push({provider_message_id: m.providerMessageId, reason: e.message});
        }
      }
      cursor = changes.cursor;
      if (o.checkpoint && changes.more) {
        await o.ingest({type: 'sync.status', status: 'healthy', provider: o.provider.name.toLowerCase(), mailbox, cursor, messages_synced: ingested - reported, backlog: 1, occurred_at: new Date().toISOString()});
        reported = ingested; saved = cursor;
      }
      if (!changes.more || (o.deadline && Date.now() > o.deadline)) break;
    }
    await o.ingest({type: 'sync.status', status: 'healthy', provider: o.provider.name.toLowerCase(), mailbox, cursor, messages_synced: ingested - reported, ...(skipped.length ? {skipped: skipped.length} : {}), occurred_at: new Date().toISOString()});
    return {status: 'healthy', cursor, ingested, skipped};
  } catch (e) {
    const expired = e instanceof MailProviderError && e.code === 'auth_expired';
    const message = e instanceof MailProviderError ? e.message : 'Mail sync failed unexpectedly.';
    await o.ingest({type: 'sync.status', status: expired ? 'expired' : 'error', provider: o.provider.name.toLowerCase(), mailbox, error: message, messages_synced: ingested - reported, occurred_at: new Date().toISOString()}).catch(() => undefined);
    return {status: expired ? 'expired' : 'error', cursor: saved, ingested, error: message, detail: e instanceof Error ? e.message : String(e)};
  }
}
