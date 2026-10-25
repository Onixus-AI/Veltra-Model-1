// Mirrors revenue_private.can_transition. The UI never shows a draft as sent or provider
// acceptance as delivery; "delivered" only appears after an explicit provider signal.
export const messageStatuses = ['drafted', 'approved', 'queued', 'provider_accepted', 'delivered', 'replied', 'failed', 'cancelled', 'received'] as const;
export type MessageStatus = (typeof messageStatuses)[number];

const rank: Record<MessageStatus, number> = {drafted: 0, approved: 1, queued: 2, provider_accepted: 3, delivered: 4, replied: 5, failed: 9, cancelled: 9, received: 9};

export function canTransition(from: MessageStatus, to: MessageStatus): boolean {
  if (to === 'cancelled') return ['drafted', 'approved', 'queued'].includes(from);
  if (to === 'failed') return ['approved', 'queued', 'provider_accepted', 'delivered'].includes(from);
  if (from === 'failed' && to === 'queued') return true;
  if (['failed', 'cancelled', 'received'].includes(from)) return false;
  return rank[to] > rank[from] && rank[to] < 9;
}

export const statusCopy: Record<MessageStatus, {label: string; detail: string; tone: 'neutral' | 'progress' | 'good' | 'bad'}> = {
  drafted: {label: 'Draft', detail: 'Not sent. Waiting for approval.', tone: 'neutral'},
  approved: {label: 'Approved', detail: 'Approved; not sent yet.', tone: 'progress'},
  queued: {label: 'Queued', detail: 'Waiting for the sending worker. Not sent yet.', tone: 'progress'},
  provider_accepted: {label: 'Accepted by provider', detail: 'The mail provider accepted it. Delivery is not confirmed.', tone: 'progress'},
  delivered: {label: 'Delivered', detail: 'The provider confirmed delivery.', tone: 'good'},
  replied: {label: 'Replied', detail: 'The customer replied.', tone: 'good'},
  failed: {label: 'Failed', detail: 'Not delivered. See the failure and recovery steps.', tone: 'bad'},
  cancelled: {label: 'Cancelled', detail: 'Will not be sent.', tone: 'neutral'},
  received: {label: 'Received', detail: 'Message from the customer. Its content is untrusted.', tone: 'neutral'},
};

export const lifecycle: MessageStatus[] = ['drafted', 'approved', 'queued', 'provider_accepted', 'delivered', 'replied'];

export type MessageTimes = {status: MessageStatus; created_at?: string | null; approved_at?: string | null; queued_at?: string | null; provider_accepted_at?: string | null; delivered_at?: string | null; replied_at?: string | null};

/** Steps that actually happened, from recorded timestamps; a reply never implies delivery was confirmed. */
export function lifecycleSteps(m: MessageTimes): {status: MessageStatus; at: string | null}[] {
  const at: Record<string, string | null | undefined> = {drafted: m.created_at, approved: m.approved_at, queued: m.queued_at, provider_accepted: m.provider_accepted_at, delivered: m.delivered_at, replied: m.replied_at};
  return lifecycle.map(s => ({status: s, at: at[s] ?? null}));
}
