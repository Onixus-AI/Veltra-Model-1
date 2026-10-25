import type {CustomerContext} from './context';
import {dealHealth, nextBestActions} from './insights';

// Sample records for /revenue/preview. The page labels them as sample data and refuses every write,
// so nothing here can be mistaken for a workspace's real numbers.
const now = Date.now();
const ago = (h: number) => new Date(now - h * 3_600_000).toISOString();
const ahead = (h: number) => new Date(now + h * 3_600_000).toISOString();
const W = '00000000-0000-4000-8000-000000000001';
const A = '00000000-0000-4000-8000-0000000000a1';
const C1 = '00000000-0000-4000-8000-0000000000c1', C2 = '00000000-0000-4000-8000-0000000000c2', C3 = '00000000-0000-4000-8000-0000000000c3';
const D1 = '00000000-0000-4000-8000-0000000000d1', D2 = '00000000-0000-4000-8000-0000000000d2', D3 = '00000000-0000-4000-8000-0000000000d3';

const stages = [
  {key: 'new', label: 'New inquiry', position: 0, outcome: 'open', probability: 10},
  {key: 'qualified', label: 'Qualified', position: 1, outcome: 'open', probability: 25},
  {key: 'meeting', label: 'Meeting booked', position: 2, outcome: 'open', probability: 40},
  {key: 'proposal', label: 'Proposal sent', position: 3, outcome: 'open', probability: 65},
  {key: 'won', label: 'Won', position: 4, outcome: 'won', probability: 100},
  {key: 'lost', label: 'Lost', position: 5, outcome: 'lost', probability: 0},
];

const context: CustomerContext = {
  customer: {id: C1, company: 'Harbor Dental Studio', name: 'Maya Chen', email: 'maya@harbordental.example', phone: '+1 555 0100', industry: 'Dental clinic', job_title: 'Practice manager',
    website: 'harbordental.example', source: 'website_form', owner_id: null, identity_review_required: false, created_at: ago(120), link: `/revenue?view=customer&customer=${C1}`},
  contactability: {blocked_reason: null, marketing_blocked_reason: 'no_marketing_consent', consents: [{channel: 'email', purpose: 'reply', status: 'granted', source: 'website_form', recorded_at: ago(120)}]},
  memory: {
    facts: [{id: 'm1', content: 'Wants online booking live before the spring promotion.', source: 'email', source_ref: 'thread:t-100', recorded_at: ago(70), confirmed_at: ago(60), expires_at: null, visibility: 'workspace'}],
    inferences: [{id: 'm2', content: 'Budget is probably under $5,000.', source: 'onyx', source_ref: 'thread:t-100', confidence: 0.55, recorded_at: ago(30), expires_at: ahead(24 * 30)}],
  },
  timeline: [
    {id: 'e5', kind: 'email.received', source: 'mail', actor_type: 'customer', actor_label: 'Maya Chen', status: 'received', summary: 'Customer replied: "Can you start in March? What does setup include?"', occurred_at: ago(6), recorded_at: ago(6), subject_type: 'message', subject_id: null, error: null, recovery: null, untrusted: true},
    {id: 'e4', kind: 'meeting.booked', source: 'crm', actor_type: 'user', actor_label: null, status: 'recorded', summary: 'Discovery call booked', occurred_at: ago(48), recorded_at: ago(48), subject_type: 'meeting', subject_id: null, error: null, recovery: null, untrusted: null},
    {id: 'e3', kind: 'email.provider_accepted', source: 'mail', actor_type: 'user', actor_label: null, status: 'provider_accepted', summary: 'Acknowledgement accepted by Gmail (delivery not confirmed)', occurred_at: ago(110), recorded_at: ago(110), subject_type: 'message', subject_id: null, error: null, recovery: null, untrusted: null},
    {id: 'e2', kind: 'email.drafted', source: 'automation', actor_type: 'automation', actor_label: 'Inquiry acknowledgement', status: 'drafted', summary: 'Acknowledgement drafted for review', occurred_at: ago(119), recorded_at: ago(119), subject_type: 'message', subject_id: null, error: null, recovery: null, untrusted: null},
    {id: 'e1', kind: 'inquiry.received', source: 'form', actor_type: 'customer', actor_label: 'Maya Chen', status: 'received', summary: 'Website inquiry: "New patient booking"', occurred_at: ago(120), recorded_at: ago(120), subject_type: 'inquiry', subject_id: null, error: null, recovery: null, untrusted: true},
  ],
  open_tasks: [{id: 'k1', title: 'Reply to Maya about the March start', due_at: ago(1), kind: 'reply', owner_id: null, overdue: true}],
  deals: [{id: D1, title: 'Online booking setup', stage: 'meeting', value_cents: 420000, currency: 'USD', owner_id: null, stage_changed_at: ago(48), outcome: 'open'}],
  meetings: [{id: 'mt1', title: 'Discovery call', starts_at: ahead(26), status: 'scheduled', deal_id: D1}],
  proposals: [], payments: [], onboarding: [],
  threads: [{account_id: A, thread_id: 't-100', subject: 'New patient booking', state: 'waiting_on_us', last_inbound_at: ago(6), last_outbound_at: ago(110), assigned_to: null, labels: null, unanswered_questions: ['Can you start in March?', 'What does setup include?'], untrusted: true}],
  messages: [
    {id: 'ms2', direction: 'inbound', status: 'received', subject: 'Re: New patient booking', to: null, purpose: 'reply', ai_generated: false, approval_source: null, failure: null, updated_at: ago(6), thread_id: 't-100', untrusted: true},
    {id: 'ms1', direction: 'outbound', status: 'replied', subject: 'Re: New patient booking', to: 'maya@harbordental.example', purpose: 'transactional', ai_generated: false, approval_source: 'user', failure: null, updated_at: ago(6), thread_id: 't-100', untrusted: false},
  ],
  generated_at: new Date(now).toISOString(),
};

const mailMessages = [
  {id: 'ms3', customer_id: C2, direction: 'outbound', purpose: 'transactional', status: 'drafted', to_email: 'ops@northwindlogistics.example', from_email: null, subject: 'Re: Fleet scheduling', thread_id: 't-200', account_id: A, ai_generated: false, approval_source: null, failure: null, created_at: ago(3), updated_at: ago(3), approved_at: null, queued_at: null, provider_accepted_at: null, delivered_at: null, replied_at: null, failed_at: null, untrusted: false},
  {id: 'ms4', customer_id: C3, direction: 'outbound', purpose: 'reply', status: 'failed', to_email: 'hello@bluefern.example', from_email: null, subject: 'Proposal follow-up', thread_id: 't-300', account_id: A, ai_generated: false, approval_source: 'user', failure: {reason: 'bounce', detail: 'Mailbox does not exist'}, created_at: ago(30), updated_at: ago(29), approved_at: ago(30), queued_at: ago(30), provider_accepted_at: ago(30), delivered_at: null, replied_at: null, failed_at: ago(29), untrusted: false},
  ...context.messages.map(m => ({id: m.id, customer_id: C1, direction: m.direction, purpose: m.purpose, status: m.status, to_email: m.to, from_email: m.direction === 'inbound' ? context.customer.email : null, subject: m.subject, thread_id: m.thread_id, account_id: A, ai_generated: false, approval_source: m.approval_source, failure: null, created_at: ago(110), updated_at: m.updated_at, approved_at: ago(110), queued_at: ago(110), provider_accepted_at: m.direction === 'outbound' ? ago(110) : null, delivered_at: null, replied_at: m.direction === 'outbound' ? ago(6) : null, failed_at: null, untrusted: m.untrusted})),
];

export const previewWorkspace = {id: W, name: 'Sample workspace', environment: 'test', role: 'owner'};

export function previewData(view: string, params: Record<string, string> = {}): unknown {
  switch (view) {
    case 'workspaces': return {user_id: 'preview', workspaces: [previewWorkspace]};
    case 'overview': return {
      overview: {period: {from: ago(24 * 30), to: ago(0)}, environment: 'test', counts_in_production_reporting: false, generated_at: ago(0),
        freshness: {latest_event_at: ago(6), mail_sync: [{account_id: A, status: 'healthy', last_synced_at: ago(0.2), last_error: null, mailbox: 'team@sample.example'}], integrations: [{provider: 'form', label: 'Website form', status: 'active', last_success_at: ago(120), last_error: null}]},
        metrics: {
          leads: {definition: 'Customers created in the period from inquiries, forms, Mail or manual entry (merged duplicates excluded; bulk discovery imports listed separately).', total: 3, discovery_imports: 0, by_source: {website_form: 2, mail: 1}, inquiries: 2, drill: '/revenue?view=customers'},
          pipeline: {definition: 'Open opportunities now, by stage; conversion = won / (won + lost) among opportunities closed in the period.', open_by_stage: {meeting: {count: 1, value_cents: 420000}, qualified: {count: 1, value_cents: 180000}, proposal: {count: 1, value_cents: 650000}}, currencies: ['USD'], won: 0, lost: 0, drill: '/revenue?view=pipeline'},
          outreach: {definition: 'Messages sent through Onixus Mail in the period by actual status. Opens are excluded: they are not evidence of a person reading. Reply rate = threads with a customer reply after our message / threads we sent to.', by_status: {drafted: 1, replied: 1, failed: 1}, replies_received: 1, threads_sent: 2, threads_replied: 1, awaiting_approval: 1, drill: '/revenue?view=mail'},
          bookings: {definition: 'Meetings booked in the period (cancelled shown separately).', scheduled: 1, cancelled: 0, upcoming: 1},
          proposals: {definition: 'Proposals created in the period by current status.', by_status: {sent: {count: 1, amount_cents: 650000}}},
          payments: {definition: 'Amounts confirmed by signed provider webhooks only. Outstanding = sent or partially paid proposals minus collected.', known: false, collected_cents: 0, refunded_cents: 0, failed: 0, outstanding_cents: 650000},
          onboarding: {definition: 'Onboardings started in the period, and current state.', started: 0, active: 0, on_hold: 0},
          commitments: {definition: 'Open tasks and commitments past their due time, now.', overdue: 1, due_today: 0},
          failures: {definition: 'Items that need recovery now.', failed_sends: 1, dead_jobs: 0, retrying_jobs: 0, sync_problems: 0, paused: false, identity_reviews: 1},
        },
        unknowns: ['No payment integration is connected: payments and collections are unknown, not zero.', 'No calendar integration: bookings only include meetings logged in Onixus CRM.', 'This is a test workspace. Its numbers are excluded from production reporting.']},
      priorities: [
        {severity: 3, kind: 'failed_send', customer_id: C3, who: 'Blue Fern Studio', why: 'A message to hello@bluefern.example failed: Mailbox does not exist', action: 'Verify the address or contact them another way', since: ago(29), link: '/revenue?view=mail&message=ms4'},
        {severity: 2, kind: 'awaiting_reply', customer_id: C1, who: 'Harbor Dental Studio', why: 'Customer wrote "New patient booking" and is waiting for a reply (2 open question(s))', action: 'Draft and approve a reply', since: ago(6), link: '/revenue?view=mail&thread=t-100'},
        {severity: 2, kind: 'overdue_task', customer_id: C1, who: 'Harbor Dental Studio', why: '"Reply to Maya about the March start" is overdue', action: 'Complete it or set a new date', since: ago(1), link: `/revenue?view=customer&customer=${C1}`},
        {severity: 1, kind: 'drafts_waiting', customer_id: C2, who: 'Northwind Logistics', why: 'A draft to ops@northwindlogistics.example is waiting for approval', action: 'Review and approve or cancel it', since: ago(3), link: '/revenue?view=mail&message=ms3'},
        {severity: 1, kind: 'identity_review', customer_id: C2, who: 'Northwind Logistics', why: 'Possible duplicate customer (phone match)', action: 'Merge or mark as different', since: ago(20), link: '/revenue?view=reviews'},
      ]};
    case 'pipeline': return {stages, deals: [
      {id: D1, customer_id: C1, company: 'Harbor Dental Studio', title: 'Online booking setup', stage: 'meeting', value_cents: 420000, currency: 'USD', owner_id: null, expected_close_at: null, stage_changed_at: ago(48), created_at: ago(120), next_task: {id: 'k1', title: 'Reply to Maya about the March start', due_at: ago(1)}, last_customer_reply_at: ago(6)},
      {id: D2, customer_id: C2, company: 'Northwind Logistics', title: 'Dispatch automation', stage: 'qualified', value_cents: 180000, currency: 'USD', owner_id: null, expected_close_at: null, stage_changed_at: ago(200), created_at: ago(260), next_task: null, last_customer_reply_at: null},
      {id: D3, customer_id: C3, company: 'Blue Fern Studio', title: 'Brand site rebuild', stage: 'proposal', value_cents: 650000, currency: 'USD', owner_id: null, expected_close_at: null, stage_changed_at: ago(150), created_at: ago(400), next_task: null, last_customer_reply_at: ago(160)},
    ]};
    case 'customers': return {customers: [
      {id: C1, company: 'Harbor Dental Studio', name: 'Maya Chen', email: 'maya@harbordental.example', source: 'website_form', owner_id: null, identity_review_required: false, suppressed: false, created_at: ago(120)},
      {id: C2, company: 'Northwind Logistics', name: 'Sam Ortiz', email: 'ops@northwindlogistics.example', source: 'mail', owner_id: null, identity_review_required: true, suppressed: false, created_at: ago(260)},
      {id: C3, company: 'Blue Fern Studio', name: 'Ari Patel', email: 'hello@bluefern.example', source: 'website_form', owner_id: null, identity_review_required: false, suppressed: true, created_at: ago(400)},
    ].filter(c => !params.q || `${c.company} ${c.name} ${c.email}`.toLowerCase().includes(params.q.toLowerCase()))};
    case 'customer': return {context, health: context.deals.map(d => dealHealth(context, d.id)), actions: nextBestActions(context)};
    case 'mail': return {messages: mailMessages, threads: [
      {...context.threads[0], customer_id: C1, reply_lock_by: null, reply_lock_until: null, last_event_at: ago(6)},
      {account_id: A, thread_id: 't-200', customer_id: C2, subject: 'Fleet scheduling', state: 'waiting_on_us', assigned_to: null, labels: null, reply_lock_by: null, reply_lock_until: null, last_inbound_at: ago(4), last_outbound_at: null, unanswered_questions: [], last_event_at: ago(3)},
    ], sync: [{account_id: A, provider: 'gmail', mailbox: 'team@sample.example', status: 'healthy', last_synced_at: ago(0.2), last_attempt_at: ago(0.2), last_error: null, messages_synced: 14}],
      identities: [{id: 'si1', email: 'team@sample.example', display_name: 'Sample team', reply_to: null, signature: '— The sample team', is_shared: true, account_id: A}], templates: []};
    case 'thread': return {messages: [
      {id: 'ms1', direction: 'outbound', status: 'replied', subject: 'Re: New patient booking', body: 'Hi Maya,\n\nThank you for contacting us about "New patient booking". A member of our team will reply within one business day.', from_email: 'team@sample.example', to_email: context.customer.email, occurred_at: ago(110), untrusted: false, ai_generated: false, failure: null},
      {id: 'ms2', direction: 'inbound', status: 'received', subject: 'Re: New patient booking', body: 'Thanks! Can you start in March? What does setup include?', from_email: context.customer.email, to_email: 'team@sample.example', occurred_at: ago(6), untrusted: true, ai_generated: false, failure: null},
    ], comments: [], summary: {summary: 'Latest customer message: asks about a March start and what setup includes.', action_items: ['Answer: Can you start in March?', 'Answer: What does setup include?'], questions: ['Can you start in March?', 'What does setup include?'], flags: []}};
    case 'automation': return {jobs: [
      {id: 'j1', kind: 'mail.send', workflow_key: null, status: 'dead', attempts: 5, max_attempts: 5, run_at: ago(29), last_error: 'Mailbox does not exist', cancel_reason: null, chain_depth: 0, customer_id: C3, message_id: 'ms4', created_at: ago(30), updated_at: ago(29), finished_at: ago(29)},
      {id: 'j2', kind: 'follow_up.check', workflow_key: 'follow_up', status: 'cancelled', attempts: 0, max_attempts: 5, run_at: ahead(48), last_error: null, cancel_reason: 'customer_replied', chain_depth: 1, customer_id: C1, message_id: 'ms1', created_at: ago(110), updated_at: ago(6), finished_at: ago(6)},
      {id: 'j3', kind: 'inquiry.acknowledge', workflow_key: 'inquiry_acknowledgement', status: 'succeeded', attempts: 1, max_attempts: 5, run_at: ago(120), last_error: null, cancel_reason: null, chain_depth: 0, customer_id: C1, message_id: null, created_at: ago(120), updated_at: ago(119), finished_at: ago(119)},
    ], workflows: [{key: 'inquiry_acknowledgement', enabled: true, auto_send_authorized: false, authorized_at: null, settings: {}, updated_at: ago(500)}, {key: 'follow_up', enabled: true, auto_send_authorized: false, authorized_at: null, settings: {}, updated_at: ago(500)}, {key: 'payment_onboarding', enabled: true, auto_send_authorized: false, authorized_at: null, settings: {}, updated_at: ago(500)}],
      controls: {automation_paused: false, pause_reason: null, paused_at: null, daily_send_limit: 50, daily_spend_limit_cents: 0},
      runs: params.job ? [{attempt: 1, worker: 'sample-worker', started_at: ago(30), finished_at: ago(30), outcome: 'retry', error: 'Mailbox does not exist', detail: {}}] : null};
    case 'reviews': return {reviews: [{id: 'r1', customer_id: C2, candidate_ids: ['00000000-0000-4000-8000-0000000000c9'], reason: 'phone_match', evidence: {phone: '+1 555 0142'}, created_at: ago(20)}], customers: [
      {id: C2, company: 'Northwind Logistics', name: 'Sam Ortiz', email: 'ops@northwindlogistics.example', phone: '+1 555 0142', source: 'mail', created_at: ago(260)},
      {id: '00000000-0000-4000-8000-0000000000c9', company: 'Northwind', name: 'Samuel Ortiz', email: 'sam@northwind.example', phone: '+1 555 0142', source: 'website_form', created_at: ago(900)},
    ]};
    default: return {};
  }
}
