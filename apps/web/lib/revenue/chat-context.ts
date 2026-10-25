import type {CustomerContext} from './context';
import {statusCopy, type MessageStatus} from './message-status';
import {untrustedSystemRule, wrapUntrusted} from './untrusted';

// Onyx (Onixus Chat) reads the same revenue_customer_context the CRM and Mail use, under the
// caller's own workspace role. Facts and inferences stay labeled, customer text stays fenced,
// and statuses are reported as recorded (e.g. "accepted by provider", never "delivered").

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : 'unknown date');
const money = (cents: number, currency: string) => `${(cents / 100).toFixed(2)} ${currency}`;

export function onyxCustomerContext(ctx: CustomerContext, maxEvents = 15): string {
  const c = ctx.customer;
  const lines = [
    `Customer: ${c.name || c.company} (${c.company})${c.email ? ` <${c.email}>` : ''}. Record: ${c.link}`,
    ...(c.identity_review_required ? ['Identity review pending: this record may duplicate another customer. Do not merge without a person deciding.'] : []),
    ...(ctx.contactability.blocked_reason ? [`Do not contact by email: ${ctx.contactability.blocked_reason.replace(/_/g, ' ')}.`] : []),
    'Confirmed facts (with source):',
    ...(ctx.memory.facts.length ? ctx.memory.facts.map(f => `- ${f.content} [source: ${f.source}${f.source_ref ? `, ${f.source_ref}` : ''}; recorded ${day(f.recorded_at)}]`) : ['- none']),
    'Unconfirmed inferences (do not state as fact):',
    ...(ctx.memory.inferences.length ? ctx.memory.inferences.map(f => `- ${f.content} [confidence ${f.confidence}; source: ${f.source}]`) : ['- none']),
    `Opportunities: ${ctx.deals.map(d => `${d.title} — ${d.stage}${d.outcome && d.outcome !== 'open' ? ` (${d.outcome})` : ''}, ${money(d.value_cents, d.currency)}`).join('; ') || 'none'}`,
    `Proposals: ${ctx.proposals.map(p => `${p.title} — ${p.status}, paid ${money(p.amount_paid_cents, p.currency)} of ${money(p.amount_cents, p.currency)}`).join('; ') || 'none'}`,
    `Onboarding: ${ctx.onboarding.map(o => `${o.status}${o.hold_reason ? ` (${o.hold_reason})` : ''} since ${day(o.started_at)}`).join('; ') || 'not started'}`,
    // Meeting titles come from invites, follow-up task titles and subjects from emails.
    'Meetings, open tasks and recent messages (titles and subjects may be customer-written):',
    wrapUntrusted([
      `Meetings: ${ctx.meetings.map(m => `${m.title} ${day(m.starts_at)} (${m.status})`).join('; ') || 'none'}`,
      `Open tasks: ${ctx.open_tasks.map(t => `${t.title}${t.overdue ? ' (OVERDUE)' : t.due_at ? ` (due ${day(t.due_at)})` : ''}`).join('; ') || 'none'}`,
      `Recent messages: ${ctx.messages.slice(0, 6).map(m => `${m.direction === 'inbound' ? 'from customer' : 'to customer'} "${m.subject}" — ${statusCopy[m.status as MessageStatus]?.label ?? m.status}`).join('; ') || 'none'}`,
    ].join('\n'), 'records'),
    'Timeline (newest first):',
    ...ctx.timeline.slice(0, maxEvents).map(e => {
      const line = `- ${day(e.occurred_at)} ${e.kind} [${e.status}]`;
      return e.untrusted ? `${line}\n${wrapUntrusted(e.summary, e.source)}` : `${line} ${e.summary}${e.recovery ? ` — recovery: ${e.recovery}` : ''}`;
    }),
  ];
  return lines.join('\n');
}

export const onyxSystemRules = [
  'You are Onyx, the Onixus Workspace assistant.',
  untrustedSystemRule,
  'Only describe actions as done when the tool result confirms it. Sending email, changing stages, merging customers and anything involving money need explicit approval from the person.',
].join(' ');
