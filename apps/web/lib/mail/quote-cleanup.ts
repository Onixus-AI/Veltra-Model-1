import type {Rpc} from '../revenue/relay';
import {MailProviderError} from '../revenue/mail-provider';
import type {GmailActions, ThreadMessage} from './gmail-actions';

// Quote request cleanup: once a rate request's thread has been quiet for the set number of days
// (Mail setting quote_cleanup_days), the other side's messages go to Gmail's Trash, which Gmail
// empties after 30 days. Our sent quotes stay in Sent. Old rate requests from before Mail was
// connected are found once by search and only listed: the owner approves them before any is trashed.

type Deps = {rpc: Rpc; accountId: string; token: string; gmail: Pick<GmailActions, 'thread' | 'trash' | 'searchThreads'>; deadline: number; now?: () => number};
type Due = {days: number | null; search_backlog: boolean; threads: {id: string; thread_id: string}[]};
const DAY = 86_400_000;

/** The Gmail search for old rate requests (broker subjects and wording), used once per mailbox. */
export const backlogQuery = (days: number) =>
  `in:inbox older_than:${days}d (subject:(rate OR rates OR quote OR quotes OR RFQ OR "rate request" OR "rate req" OR "rate confirmation request") OR "rate request" OR "need a rate" OR "quote request" OR "can you quote")`;

export async function cleanQuoteRequests(d: Deps): Promise<{trashed: number; waiting: number; proposed?: number; failed: number} | {off: true}> {
  const now = d.now ?? Date.now;
  const due = await d.rpc<Due>('mail_quote_cleanup_due', {p_account: d.accountId, p_token: d.token, p_limit: 15});
  if (!due.days) return {off: true};
  const days = due.days, cutoff = now() - days * DAY;
  const out = {trashed: 0, waiting: 0, failed: 0} as {trashed: number; waiting: number; proposed?: number; failed: number};
  const result = (id: string, status: 'trashed' | 'waiting' | 'kept' | 'failed', last: number | null, trashed: number, detail: string) =>
    d.rpc('mail_quote_cleanup_result', {p_account: d.accountId, p_token: d.token, p_id: id, p_status: status,
      p_last_message_at: last ? new Date(last).toISOString() : null, p_trashed: trashed, p_detail: detail});

  for (const t of due.threads) {
    if (now() > d.deadline - 8_000) break;
    try {
      const messages = await d.gmail.thread(t.thread_id);
      const last = Math.max(0, ...messages.map(m => m.at));
      if (!messages.length) { await result(t.id, 'kept', null, 0, 'The thread is no longer in Gmail.'); continue; }
      if (last > cutoff) { await result(t.id, 'waiting', last, 0, `Still active: cleaned ${days} days after the last message.`); out.waiting++; continue; }
      // Only the other side's messages: our sent quotes stay as the record of what we quoted.
      const theirs = messages.filter(m => !m.sent && !m.draft);
      for (const m of theirs) await d.gmail.trash(m.id);
      await result(t.id, 'trashed', last, theirs.length, theirs.length ? 'Moved to Trash.' : 'Nothing from the sender left in the thread.');
      out.trashed += theirs.length;
    } catch (e) {
      const gone = e instanceof MailProviderError && /no longer in Gmail/.test(e.message);
      await result(t.id, gone ? 'kept' : 'failed', null, 0, gone ? 'The thread is no longer in Gmail.' : (e instanceof Error ? e.message.slice(0, 200) : 'Failed.')).catch(() => undefined);
      if (!gone) out.failed++;
    }
  }

  if (due.search_backlog && now() < d.deadline - 20_000) out.proposed = await findBacklog(d, days, cutoff);
  return out;
}

/** Finds old rate request threads quiet for `days` and lists them for the owner. Trashes nothing. */
async function findBacklog(d: Deps, days: number, cutoff: number): Promise<number> {
  const ids = await d.gmail.searchThreads(backlogQuery(days), 300);
  const items: {thread_id: string; subject: string; from_email: string; last_message_at: string}[] = [];
  for (let i = 0; i < ids.length; i += 10) {
    // Out of time: search again next pass rather than record a half-finished search.
    if ((d.now ?? Date.now)() > d.deadline - 8_000) return 0;
    const threads = await Promise.all(ids.slice(i, i + 10).map(id => d.gmail.thread(id).then(m => [id, m] as const).catch(() => [id, [] as ThreadMessage[]] as const)));
    for (const [id, messages] of threads) {
      const theirs = messages.filter(m => !m.sent && !m.draft);
      const last = Math.max(0, ...messages.map(m => m.at));
      if (!theirs.length || last > cutoff) continue;
      items.push({thread_id: id, subject: theirs[0]!.subject.slice(0, 300), from_email: theirs[0]!.from, last_message_at: new Date(last).toISOString()});
    }
  }
  const r = await d.rpc<{added: number}>('mail_quote_backlog_add', {p_account: d.accountId, p_token: d.token, p_items: items});
  return r.added ?? 0;
}
