// Shape returned by public.revenue_customer_context — the one context used by CRM, Mail and Chat.
export type TimelineEvent = {id: string; kind: string; source: string; actor_type: string; actor_label: string | null; status: string; summary: string;
  occurred_at: string; recorded_at: string; subject_type: string | null; subject_id: string | null; error: Record<string, unknown> | null; recovery: string | null; untrusted: boolean | null};
export type CustomerContext = {
  customer: {id: string; company: string; name: string; email: string | null; phone: string; industry: string; job_title: string; website: string; source: string;
    owner_id: string | null; identity_review_required: boolean; created_at: string; link: string};
  contactability: {blocked_reason: string | null; marketing_blocked_reason: string | null; consents: {channel: string; purpose: string; status: string; source: string; recorded_at: string}[]};
  memory: {facts: {id: string; content: string; source: string; source_ref: string | null; recorded_at: string; confirmed_at: string | null; expires_at: string | null; visibility: string}[];
    inferences: {id: string; content: string; source: string; source_ref: string | null; confidence: number; recorded_at: string; expires_at: string | null}[]};
  timeline: TimelineEvent[];
  open_tasks: {id: string; title: string; due_at: string | null; kind: string; owner_id: string | null; overdue: boolean}[];
  deals: {id: string; title: string; stage: string; value_cents: number; currency: string; owner_id: string | null; stage_changed_at: string | null; outcome: 'open' | 'won' | 'lost' | null}[];
  meetings: {id: string; title: string; starts_at: string; status: string; deal_id: string | null}[];
  proposals: {id: string; title: string; status: string; amount_cents: number; amount_paid_cents: number; currency: string; sent_at: string | null}[];
  payments: {id: string; status: string; amount_received_cents: number; amount_refunded_cents: number; currency: string; last_event_at: string | null; failure: unknown}[];
  onboarding: {id: string; status: string; started_at: string; hold_reason: string | null}[];
  threads: {account_id: string; thread_id: string; subject: string; state: string | null; last_inbound_at: string | null; last_outbound_at: string | null; assigned_to: string | null; labels: string[] | null; unanswered_questions: string[] | null; untrusted: true}[];
  messages: {id: string; direction: string; status: string; subject: string; to: string | null; purpose: string; ai_generated: boolean; approval_source: string | null; failure: {reason?: string; detail?: string} | null; updated_at: string; thread_id: string | null; untrusted: boolean}[];
  generated_at: string;
};

export const eventLink = (e: Pick<TimelineEvent, 'id'>) => `/revenue?view=customer&event=${e.id}`;
