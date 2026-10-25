import {eventLink, type CustomerContext, type TimelineEvent} from './context';

// Deal health and next-best actions are computed only from recorded evidence (timeline events,
// tasks, proposals, payments). Email opens and AI inferences never count as evidence, and
// nothing here changes a stage: recommendations are suggestions a person acts on.

export type Signal = {label: string; effect: 'positive' | 'negative' | 'neutral'; evidence: {kind: string; at: string; link: string} | null};
export type DealHealth = {deal_id: string; status: 'healthy' | 'needs_attention' | 'at_risk' | 'closed' | 'unknown'; signals: Signal[]; summary: string};

const day = 86_400_000;
const latest = (events: TimelineEvent[], kinds: string[]) => events.filter(e => kinds.includes(e.kind)).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))[0];
const ev = (e: TimelineEvent | undefined) => (e ? {kind: e.kind, at: e.occurred_at, link: eventLink(e)} : null);

export function dealHealth(ctx: CustomerContext, dealId: string, now = Date.now()): DealHealth {
  const deal = ctx.deals.find(d => d.id === dealId);
  if (!deal) return {deal_id: dealId, status: 'unknown', signals: [], summary: 'Opportunity not found in this customer context.'};
  if (deal.outcome === 'won' || deal.outcome === 'lost') return {deal_id: dealId, status: 'closed', signals: [], summary: `Closed (${deal.stage}).`};
  const signals: Signal[] = [];
  const reply = latest(ctx.timeline, ['email.received', 'form.submitted']);
  const sent = latest(ctx.timeline, ['email.provider_accepted', 'email.sent_outside']);
  const meeting = ctx.meetings.find(m => m.status === 'scheduled' && Date.parse(m.starts_at) > now);
  const failed = ctx.messages.filter(m => m.status === 'failed');
  const overdue = ctx.open_tasks.filter(t => t.overdue);
  const proposal = ctx.proposals.find(p => ['sent', 'partially_paid', 'payment_failed'].includes(p.status));

  if (reply) signals.push({label: `Customer last wrote ${ago(reply.occurred_at, now)}`, effect: now - Date.parse(reply.occurred_at) < 14 * day ? 'positive' : 'negative', evidence: ev(reply)});
  else signals.push({label: 'No message from the customer is recorded', effect: 'negative', evidence: null});
  if (sent && (!reply || sent.occurred_at > reply.occurred_at) && now - Date.parse(sent.occurred_at) > 5 * day)
    signals.push({label: `Our last message (${ago(sent.occurred_at, now)}) has no reply`, effect: 'negative', evidence: ev(sent)});
  if (meeting) signals.push({label: `Meeting booked for ${meeting.starts_at.slice(0, 10)}`, effect: 'positive', evidence: {kind: 'meeting.scheduled', at: meeting.starts_at, link: `/revenue?view=customer&customer=${ctx.customer.id}`}});
  if (proposal) signals.push({label: `Proposal "${proposal.title}" is ${proposal.status.replace('_', ' ')}`, effect: proposal.status === 'payment_failed' ? 'negative' : 'neutral', evidence: null});
  if (overdue.length) signals.push({label: `${overdue.length} overdue task${overdue.length > 1 ? 's' : ''}`, effect: 'negative', evidence: null});
  if (failed.length) signals.push({label: `${failed.length} failed message${failed.length > 1 ? 's' : ''}`, effect: 'negative', evidence: null});
  if (!ctx.open_tasks.length) signals.push({label: 'No next action is scheduled', effect: 'negative', evidence: null});
  const stale = deal.stage_changed_at && now - Date.parse(deal.stage_changed_at) > 30 * day;
  if (stale) signals.push({label: `In "${deal.stage}" for ${Math.round((now - Date.parse(deal.stage_changed_at!)) / day)} days`, effect: 'negative', evidence: null});

  const negatives = signals.filter(s => s.effect === 'negative').length, positives = signals.filter(s => s.effect === 'positive').length;
  const status = negatives >= 3 ? 'at_risk' : negatives > positives ? 'needs_attention' : 'healthy';
  return {deal_id: dealId, status, signals, summary: status === 'healthy' ? 'Recent two-way activity and a next step are recorded.' : status === 'at_risk' ? 'Several warning signs; act on the recommendations.' : 'Some follow-up is needed.'};
}

export type Recommendation = {action: string; reason: string; sources: {label: string; link: string}[]; requires_approval: boolean; kind: string};

export function nextBestActions(ctx: CustomerContext, now = Date.now()): Recommendation[] {
  const recs: Recommendation[] = [];
  const customerLink = `/revenue?view=customer&customer=${ctx.customer.id}`;
  if (ctx.customer.identity_review_required) recs.push({kind: 'identity', action: 'Confirm this customer is not a duplicate', reason: 'Identity matching found a possible duplicate record.', sources: [{label: 'Identity reviews', link: '/revenue?view=reviews'}], requires_approval: false});
  if (ctx.contactability.blocked_reason) {
    recs.push({kind: 'contact', action: 'Do not email this customer', reason: `Outbound email is blocked (${ctx.contactability.blocked_reason.replace(/_/g, ' ')}).`, sources: [{label: 'Contactability', link: customerLink}], requires_approval: false});
  }
  for (const m of ctx.messages.filter(m => m.status === 'failed').slice(0, 3))
    recs.push({kind: 'recovery', action: m.failure?.reason === 'bounce' ? 'Verify the address before contacting again' : 'Fix the failure and retry the message', reason: `"${m.subject}" failed: ${m.failure?.detail ?? m.failure?.reason ?? 'unknown error'}.`, sources: [{label: 'Message', link: `/revenue?view=mail&message=${m.id}`}], requires_approval: true});
  const waiting = ctx.threads.filter(t => t.state === 'waiting_on_us');
  for (const t of waiting.slice(0, 3)) {
    const q = t.unanswered_questions?.length ? ` It contains ${t.unanswered_questions.length} unanswered question(s).` : '';
    if (!ctx.contactability.blocked_reason) recs.push({kind: 'reply', action: 'Reply to the customer', reason: `"${t.subject}" is waiting for our reply since ${t.last_inbound_at?.slice(0, 16).replace('T', ' ')} UTC.${q}`, sources: [{label: 'Conversation', link: `/revenue?view=mail&thread=${encodeURIComponent(t.thread_id)}`}], requires_approval: true});
  }
  const drafts = ctx.messages.filter(m => m.status === 'drafted' && m.direction === 'outbound');
  if (drafts.length) recs.push({kind: 'approve', action: `Review ${drafts.length} draft${drafts.length > 1 ? 's' : ''} waiting for approval`, reason: 'Drafts are never sent without approval.', sources: drafts.slice(0, 3).map(d => ({label: d.subject || 'Draft', link: `/revenue?view=mail&message=${d.id}`})), requires_approval: true});
  for (const t of ctx.open_tasks.filter(t => t.overdue).slice(0, 3)) recs.push({kind: 'task', action: `Complete or reschedule "${t.title}"`, reason: `It was due ${t.due_at?.slice(0, 10)}.`, sources: [{label: 'Tasks', link: customerLink}], requires_approval: false});
  const open = ctx.deals.filter(d => d.outcome === 'open');
  const meetingDone = ctx.meetings.some(m => m.status === 'scheduled' && Date.parse(m.starts_at) < now) || ctx.meetings.some(m => m.status === 'completed');
  for (const d of open) {
    const hasProposal = ctx.proposals.some(p => p.status !== 'cancelled');
    if (meetingDone && !hasProposal) recs.push({kind: 'proposal', action: `Prepare a proposal for "${d.title}"`, reason: 'A meeting has taken place and no proposal is recorded.', sources: [{label: 'Opportunity', link: customerLink}], requires_approval: true});
    const meeting = ctx.meetings.find(m => m.deal_id === d.id && m.status === 'scheduled');
    if (meeting && ['new', 'qualified'].includes(d.stage)) recs.push({kind: 'stage', action: `Consider moving "${d.title}" to Meeting`, reason: `A meeting is booked (${meeting.starts_at.slice(0, 10)}). Stage changes are your decision.`, sources: [{label: 'Meeting', link: customerLink}], requires_approval: true});
  }
  const unpaid = ctx.proposals.find(p => p.status === 'sent' && p.sent_at && now - Date.parse(p.sent_at) > 5 * day);
  if (unpaid) recs.push({kind: 'proposal_follow_up', action: `Follow up on proposal "${unpaid.title}"`, reason: `Sent ${unpaid.sent_at!.slice(0, 10)} and no verified payment is recorded.`, sources: [{label: 'Proposal', link: customerLink}], requires_approval: true});
  const failedPay = ctx.proposals.find(p => p.status === 'payment_failed');
  if (failedPay) recs.push({kind: 'payment', action: 'Send a new payment link or contact the customer', reason: `The payment for "${failedPay.title}" failed.`, sources: [{label: 'Payments', link: customerLink}], requires_approval: true});
  const hold = ctx.onboarding.find(o => o.status === 'on_hold');
  if (hold) recs.push({kind: 'onboarding', action: 'Review the onboarding hold', reason: hold.hold_reason ?? 'Onboarding is on hold.', sources: [{label: 'Onboarding', link: customerLink}], requires_approval: false});
  if (!ctx.open_tasks.length && open.length && !recs.length) recs.push({kind: 'task', action: 'Schedule a next action', reason: 'This customer has an open opportunity but no next step.', sources: [{label: 'Customer', link: customerLink}], requires_approval: false});
  if (ctx.memory.inferences.length) recs.push({kind: 'memory', action: `Confirm or reject ${ctx.memory.inferences.length} AI inference${ctx.memory.inferences.length > 1 ? 's' : ''}`, reason: 'Unconfirmed inferences are not used as facts.', sources: [{label: 'Memory', link: customerLink}], requires_approval: false});
  return recs;
}

function ago(iso: string, now: number) {
  const d = Math.max(0, Math.round((now - Date.parse(iso)) / day));
  return d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
}
