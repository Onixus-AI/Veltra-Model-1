import type {Rpc} from '../revenue/relay';
import type {MailProvider, ProviderMessage} from '../revenue/mail-provider';
import {replySubject} from '../revenue/mail-provider';
import {ruleClassification, type Brain, type Business, type Classification} from './brain';
import {MAIL_LABELS, type GmailActions} from './gmail-actions';
import {parseUnsubscribe, unsubscriber as makeUnsubscriber, type UnsubResult} from './unsubscribe';
import {validRateCard, writeQuote, type Distance, type RateCard} from './quote';

// Mail as an employee: after each sync, sort a few new emails, plan what to do with each, label
// it in Gmail (labels are harmless and always applied), draft replies, then carry out whatever a
// person approved or the owner put on autopilot. The model labels and writes; this code decides.
// Ported from Onixus Mail's agent (Railway, retired 2026-11).

export type Settings = {auto_clean: boolean; delete_junk: boolean; unsubscribe: boolean; auto_send: string[]; tms_org_id?: string | null;
  /** Trucking rate card: Mail quotes from it, with the standard disclaimers. */
  rate_card?: RateCard | null; signature?: string | null; quote_valid_days?: number | null};
export type Plan =
  | {action: 'trash' | 'archive'; unsubscribe: boolean; label: string; headline: string}
  | {action: 'reply'; purpose: 'ANSWER' | 'QUOTE' | 'DOCUMENT_RECEIVED'; label: string; headline: string; to: string; message_id_header: string | null; references: string | null; needs_review?: boolean; price?: unknown; quote_method?: string; quote_note?: string}
  | {action: 'none'; label: string; headline: string};
export type QuoteLane = (lane: NonNullable<NonNullable<Classification['quote']>['freight']>) => Promise<Record<string, unknown> | null>;

const CLEAN = new Set(['JUNK', 'NEWSLETTER', 'COLD_OUTREACH', 'NOTIFICATION']);
const who = (m: ProviderMessage) => m.fromName || m.from;
// Shared inboxes (dray@, dispatch@, quotes@…) often show their mailbox name as the sender name: no "Hi dray,".
const ROLE = /^(dray(age)?|dispatch|log|ops|operations|info|sales|quotes?|rates?|pricing|logistics|freight|booking|bookings|import|export|support|admin|office|team|hello|contact|customer-?service|cs|accounts?|billing|ap|ar|noreply|no-?reply)$/i;
export const greeting = (m: Pick<ProviderMessage, 'fromName' | 'from'>) => {
  const first = m.fromName.trim().split(/\s+/)[0] ?? '';
  const person = /^[A-Za-z][A-Za-z'-]{1,30}$/.test(first) && !ROLE.test(first);
  return person ? `Hi ${first},` : 'Hello,';
};
// A rate request on a deadline (last free day, today/tomorrow, urgent) is at least HIGH, whatever the model said.
const DEADLINE = /\b(urgent|asap|lfd|last free day|today|tomorrow|tmrw|cut-?off|expedite[d]?|hot load|same day)\b/i;
export const withDeadlinePriority = (c: Classification, e: {subject: string; text: string}): Classification =>
  c.category === 'QUOTE_REQUEST' && (c.priority === 'NORMAL' || c.priority === 'LOW') && DEADLINE.test(`${e.subject}\n${e.text.slice(0, 3000)}`) ? {...c, priority: 'HIGH'} : c;
const signatureOf = (d: Pick<EmployeeDeps, 'settings' | 'business'>) => d.settings.signature?.trim() || `${d.business.name} team`;

/** What to do with one sorted email. Junk is deleted only when sure and attachment-free. */
export function planFor(c: Classification, m: ProviderMessage, s: Settings): Plan {
  const label = MAIL_LABELS[c.category];
  if (c.category === 'JUNK') {
    const sure = s.delete_junk && c.confidence >= 0.85 && m.attachments.length === 0;
    return {action: sure ? 'trash' : 'archive', unsubscribe: false, label, headline: sure ? `Delete junk from ${who(m)}: "${m.subject}"` : `Archive possible junk from ${who(m)}: "${m.subject}"`};
  }
  if (CLEAN.has(c.category)) {
    const unsubscribe = s.unsubscribe && (c.category === 'NEWSLETTER' || c.category === 'COLD_OUTREACH');
    const what = c.category === 'COLD_OUTREACH' ? 'cold pitch' : c.category === 'NEWSLETTER' ? 'newsletter' : 'notification';
    return {action: 'archive', unsubscribe, label, headline: unsubscribe ? `Unsubscribe from ${who(m)} (${what}) and archive it` : `Archive ${what} from ${who(m)}`};
  }
  const reply = (purpose: 'ANSWER' | 'QUOTE' | 'DOCUMENT_RECEIVED', headline: string): Plan =>
    ({action: 'reply', purpose, label, headline, to: m.from, message_id_header: m.messageIdHeader, references: m.references});
  if (c.category === 'QUOTE_REQUEST') return reply('QUOTE', `Quote for ${who(m)}: ${c.quote?.request ?? m.subject}`);
  if (c.category === 'QUESTION') return reply('ANSWER', `Answer ${who(m)}: ${c.summary}`);
  if (c.category === 'DOCUMENT') return reply('DOCUMENT_RECEIVED', `Confirm receipt of ${who(m)}'s document`);
  return {action: 'none', label, headline: c.summary};
}

export type EmployeeDeps = {
  rpc: Rpc; accountId: string; token: string; mailbox: string; business: Business; settings: Settings;
  brain: Brain | null; gmail: GmailActions; mail: MailProvider; quoteLane?: QuoteLane | null; distance?: Distance | null;
  unsubscribe?: (u: NonNullable<ReturnType<typeof parseUnsubscribe>>) => Promise<UnsubResult>;
  deadline: number; sortLimit?: number;
};
const args = (d: EmployeeDeps, extra: Record<string, unknown>) => ({p_account: d.accountId, p_token: d.token, ...extra});

/** Notes every new inbound email from this pass as 'unsorted', so none is lost if time runs out. */
export async function noteNew(d: Pick<EmployeeDeps, 'rpc' | 'accountId' | 'token' | 'mailbox'>, messages: ProviderMessage[]) {
  const items = messages.filter(m => m.direction === 'inbound' && !m.bounce && m.from && m.from !== d.mailbox.toLowerCase())
    .map(m => ({provider_message_id: m.providerMessageId, thread_id: m.threadId, from_email: m.from, from_name: m.fromName, subject: m.subject}));
  for (let i = 0; i < items.length; i += 200) await d.rpc('mail_items_note', {p_account: d.accountId, p_token: d.token, p_items: items.slice(i, i + 200)});
  return items.length;
}

/** Sorts up to sortLimit unsorted emails, oldest first. Without a model nothing is sorted: emails wait, unguessed. */
export async function sortSome(d: EmployeeDeps): Promise<{sorted: number; skipped: number}> {
  if (!d.brain) return {sorted: 0, skipped: 0};
  const due = await d.rpc<{id: string; provider_message_id: string}[]>('mail_items_unsorted', args(d, {p_limit: d.sortLimit ?? 5}));
  let sorted = 0;
  const skipped = 0;
  for (const item of due) {
    if (Date.now() > d.deadline - 20_000) break; // a sort can take two model calls; don't start one that can't finish
    try {
      const m = await d.gmail.get(item.provider_message_id, d.mailbox);
      const unsub = d.settings.unsubscribe ? await d.gmail.unsubscribeHeaders(m.providerMessageId).catch(() => ({listUnsubscribe: undefined})) : {listUnsubscribe: undefined};
      const email = {from: m.from, fromName: m.fromName, subject: m.subject, text: m.text, attachments: m.attachments};
      const c = withDeadlinePriority(ruleClassification({...email, listUnsubscribe: unsub.listUnsubscribe ?? null}) ?? await d.brain.classify(email, d.business), email);
      const plan = planFor(c, m, d.settings);
      let draft: string | null = null;
      if (plan.action === 'reply' && plan.purpose === 'QUOTE') {
        // In trucking a rate request is answered with a rate and the disclaimers. Code writes it.
        const freight = c.quote?.freight ?? null;
        const tms = freight && d.quoteLane ? await d.quoteLane(freight).catch(() => null) : null;
        const card = validRateCard(d.settings.rate_card) ? d.settings.rate_card : null;
        const q = await writeQuote({lane: freight, tms, card, distance: d.distance ?? null, signature: signatureOf(d), validDays: d.settings.quote_valid_days ?? undefined, greeting: greeting(m)});
        if (q) { draft = q.body; plan.price = q.total; plan.quote_method = q.method; plan.needs_review = false; if (q.note) plan.quote_note = q.note; }
        else { plan.needs_review = true; draft = await d.brain.draft('QUOTE', email, d.business, {business: d.business.name, request: c.quote?.request ?? null, lane: freight, price: null, pricing: 'no price available: say a rate will follow'}); }
      } else if (plan.action === 'reply') {
        draft = await d.brain.draft(plan.purpose, email, d.business, {business: d.business.name, signature: signatureOf(d)});
      }
      if (plan.action === 'reply' && !draft) plan.needs_review = true;
      await d.gmail.label(m.providerMessageId, plan.label, false);
      await d.rpc('mail_item_record', args(d, {p_item: {provider_message_id: m.providerMessageId, thread_id: m.threadId, from_email: m.from, from_name: m.fromName,
        subject: m.subject, category: c.category, confidence: c.confidence, summary: c.summary, priority: c.priority, needs_owner: c.needs_owner,
        owner_reason: c.owner_reason ?? null, plan, draft}}));
      sorted++;
    } catch (e) {
      await d.rpc('mail_item_attempt', args(d, {p_id: item.id, p_error: e instanceof Error ? e.message : 'Sorting failed.'})).catch(() => undefined);
    }
  }
  return {sorted, skipped};
}

type Due = {id: string; provider_message_id: string; thread_id: string | null; from_email: string; subject: string; category: string; plan: Plan; draft: string | null};

/** Carries out approved items: archive, delete, unsubscribe, or send the reply (once, by item id). */
export async function actOnApproved(d: EmployeeDeps): Promise<{done: number; failed: number}> {
  const due = await d.rpc<Due[]>('mail_items_due', args(d, {p_limit: 10}));
  let done = 0, failed = 0;
  for (const it of due) {
    if (Date.now() > d.deadline) break;
    const result: Record<string, unknown> = {};
    try {
      const p = it.plan;
      if (p.action === 'trash') { await d.gmail.trash(it.provider_message_id); result.trashed = true; }
      if (p.action === 'archive') { await d.gmail.label(it.provider_message_id, p.label, true); result.archived = true; }
      if ((p.action === 'trash' || p.action === 'archive') && p.unsubscribe) {
        const h = await d.gmail.unsubscribeHeaders(it.provider_message_id);
        const u = parseUnsubscribe(h.listUnsubscribe, h.listUnsubscribePost);
        const unsubscribe = d.unsubscribe ?? makeUnsubscriber({send: m => d.mail.send({idempotencyKey: `mail-unsub-${it.id}`, from: d.mailbox, to: m.to, subject: m.subject, body: m.body})});
        result.unsubscribe = u ? await unsubscribe(u) :  {method: 'none', ok: false, detail: 'The sender offers no unsubscribe link.'};
      }
      if (p.action === 'reply') {
        if (!it.draft) throw new Error('No reply text to send.');
        const sent = await d.mail.send({idempotencyKey: `mail-item-${it.id}`, from: d.mailbox, to: p.to, subject: replySubject(it.subject), body: it.draft,
          threadId: it.thread_id, inReplyTo: p.message_id_header, references: p.references});
        result.sent = {provider_message_id: sent.providerMessageId};
      }
      await d.rpc('mail_item_done', args(d, {p_id: it.id, p_ok: true, p_result: result}));
      done++;
    } catch (e) {
      await d.rpc('mail_item_done', args(d, {p_id: it.id, p_ok: false, p_result: {...result, error: e instanceof Error ? e.message.slice(0, 300) : 'Failed.'}})).catch(() => undefined);
      failed++;
    }
  }
  return {done, failed};
}
