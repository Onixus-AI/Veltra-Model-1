import {MailProviderError, type MailProvider} from './mail-provider';
import {syncMailbox, type SyncResult} from './mail-sync';
import {runWorker, type WorkerDeps, type WorkerReport} from './worker';
import {syncCalendar, type CalendarProvider, type CalendarState, type CalendarSyncResult} from './calendar';

// The Onixus Mail relay: one pass per connected mailbox, authenticated with that mailbox's CRM
// token (the same token Mail already uses for crm_ingest_mail). Order matters:
//  1. Sync Gmail first, so a reply that arrived is recorded (and stops follow-ups) before
//     anything else is sent to that customer.
//  2. Send queued messages only while the Google connection is healthy. The database decides
//     eligibility (pause, limits, suppression, consent) when it hands out a job.
//  3. Read calendar changes, when enabled for this mailbox.
// The same module runs inside Onixus Mail (copied) and in the web app's acceptance harness.

export type Rpc = <T = unknown>(fn: string, args: Record<string, unknown>) => Promise<T>;

export type AccountState = {
  workspace_id: string;
  mail: {cursor: string | null; status: string; mailbox: string | null} | null;
  calendar: (NonNullable<CalendarState> & {status: string}) | null;
  sends_waiting: number;
};

export type RelayDeps = {
  rpc: Rpc;
  accountId: string;
  token: string;
  workerId: string;
  mail: MailProvider;
  calendar?: CalendarProvider | null;
  sendLimit?: number;
};

export type RelayReport = {
  sync: SyncResult;
  send: WorkerReport | {skipped: 'connection_expired'};
  calendar: CalendarSyncResult | {skipped: 'disabled' | 'connection_expired'};
};

const args = (d: Pick<RelayDeps, 'accountId' | 'token'>, extra: Record<string, unknown> = {}) => ({p_account: d.accountId, p_token: d.token, ...extra});

/** Refuses a From address the mailbox cannot send as, instead of letting Gmail silently rewrite it. */
export function senderChecked(mail: MailProvider): MailProvider {
  let allowed: Promise<string[]> | null = null;
  return {
    ...mail,
    async send(m) {
      allowed ??= mail.senders ? mail.senders() : mail.address().then(a => [a]);
      const list = await allowed.catch(e => { allowed = null; throw e; });
      if (!list.includes(m.from.toLowerCase()))
        throw new MailProviderError('sender_not_allowed', `This mailbox cannot send as ${m.from}. Use ${list[0]} or add it as a verified send-as address in Gmail.`, false);
      return mail.send(m);
    },
  };
}

export function relayWorkerDeps(d: RelayDeps): WorkerDeps {
  const mail = senderChecked(d.mail);
  return {
    workerId: d.workerId,
    claim: limit => d.rpc('revenue_mail_claim', args(d, {p_worker: d.workerId, p_limit: limit})),
    complete: (jobId, result) => d.rpc('revenue_mail_complete', args(d, {p_job: jobId, p_worker: d.workerId, p_result: result})),
    providerFor: async accountId => (accountId === d.accountId ? mail : null),
  };
}

export async function relayAccount(d: RelayDeps): Promise<RelayReport> {
  const state = await d.rpc<AccountState>('revenue_mail_account_state', args(d));
  const sync = await syncMailbox({provider: d.mail, cursor: state.mail?.cursor ?? null, ingest: event => d.rpc('revenue_ingest_mail_event', args(d, {p_event: event}))});
  const expired = sync.status === 'expired';
  const send = expired ? {skipped: 'connection_expired' as const} : await runWorker(relayWorkerDeps(d), d.sendLimit ?? 10);
  let calendar: RelayReport['calendar'] = {skipped: 'disabled'};
  if (d.calendar && expired) calendar = {skipped: 'connection_expired'};
  else if (d.calendar) {
    const mailbox = await d.mail.address().catch(() => state.mail?.mailbox ?? null);
    calendar = await syncCalendar({provider: d.calendar, state: state.calendar, mailbox,
      ingest: event => d.rpc('revenue_mail_calendar_event', args(d, {p_event: event})),
      status: status => d.rpc('revenue_mail_calendar_status', args(d, {p_status: status}))});
  }
  return {sync, send, calendar};
}
