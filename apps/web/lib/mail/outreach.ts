import type {Rpc} from '../revenue/relay';
import {MailProviderError, type MailProvider, type ProviderMessage} from '../revenue/mail-provider';
import type {GmailActions} from './gmail-actions';

// Outreach autopilot: a mailbox the owner switched on sends at most one queued first-touch email
// per pass. The database decides whether one may go now (weekdays 9–4 Eastern, daily number,
// spacing, nobody who already wrote to us); this code sends it and reports what happened.
// Replies stop outreach to that company, and "no thanks" or a bounce suppresses it in the CRM.

type Deps = {rpc: Rpc; accountId: string; token: string; mailbox: string; mail: MailProvider; gmail: Pick<GmailActions, 'sendDraft'>; deadline: number};
type Next = {id?: string; to_email?: string; subject?: string; body?: string | null; gmail_draft_id?: string | null; reason?: string};

// Someone asking not to be emailed again. Read only from the start of their reply, not our quoted text.
export const OPT_OUT = /\b(no,? thanks?|no thank you|not interested|unsubscribe|remove (me|us)|take (me|us) off|stop (emailing|sending|contacting)|do not (email|contact)|don'?t (email|contact))\b/i;
export const optedOut = (text: string) => OPT_OUT.test(text.split(/\n\s*(?:>|On .{5,120}wrote:|-{2,}\s*Original Message)/i)[0]!.slice(0, 2000));

/** Tells the database about this pass's new inbound mail so replies and bounces stop outreach. */
export async function noteOutreachReplies(d: Pick<Deps, 'rpc' | 'accountId' | 'token' | 'mailbox'>, messages: ProviderMessage[]) {
  const self = d.mailbox.toLowerCase();
  type Item = {bounce_recipient: string} | {from_email: string; opt_out: boolean};
  const items: Item[] = messages.filter(m => m.direction === 'inbound' && m.from && m.from.toLowerCase() !== self).flatMap((m): Item[] =>
    m.bounce?.recipient ? [{bounce_recipient: m.bounce.recipient.toLowerCase()}]
      : m.automated ? [] : [{from_email: m.from.toLowerCase(), opt_out: optedOut(m.text ?? '')}]);
  let updated = 0;
  for (let i = 0; i < items.length; i += 200) updated += (await d.rpc<{updated: number}>('mail_outreach_replies', {p_account: d.accountId, p_token: d.token, p_items: items.slice(i, i + 200)})).updated ?? 0;
  return updated;
}

/** Sends the next queued outreach email if one is allowed now. Never retries a send that may have gone out. */
export async function sendOutreach(d: Deps): Promise<{sent: number; reason?: string; skipped?: string; failed?: string}> {
  if (Date.now() > d.deadline - 10_000) return {sent: 0, reason: 'no time left in this pass'};
  const next = await d.rpc<Next | null>('mail_outreach_next', {p_account: d.accountId, p_token: d.token});
  if (!next?.id) return {sent: 0, reason: next?.reason ?? 'nothing due'};
  const done = (status: 'sent' | 'skipped' | 'failed', detail: string, providerMessageId: string | null = null) =>
    d.rpc('mail_outreach_done', {p_account: d.accountId, p_token: d.token, p_id: next.id, p_status: status, p_detail: detail, p_provider_message_id: providerMessageId});
  try {
    const sent = next.gmail_draft_id
      ? await d.gmail.sendDraft(next.gmail_draft_id, next.to_email!)
      : await d.mail.send({idempotencyKey: `mail-outreach-${next.id}`, from: d.mailbox, to: next.to_email!, subject: next.subject ?? '', body: next.body ?? ''});
    await done('sent', '', sent.providerMessageId);
    return {sent: 1};
  } catch (e) {
    const message = e instanceof Error ? e.message.slice(0, 300) : 'Sending failed.';
    // A draft that was deleted or re-addressed in Gmail is the owner's decision: skip it.
    const skip = e instanceof OutreachSkip || (e instanceof MailProviderError && e.code === 'rejected' && /no longer in Gmail/.test(e.message));
    await done(skip ? 'skipped' : 'failed', skip ? (e instanceof OutreachSkip ? e.message : 'The draft was deleted in Gmail.') : message).catch(() => undefined);
    return skip ? {sent: 0, skipped: next.to_email} : {sent: 0, failed: message};
  }
}

export class OutreachSkip extends Error {}
