-- Onixus revenue system, Phase 1, part 2: Onixus Mail message lifecycle, shared-inbox
-- ownership, suppression, sync health, and the durable automation engine.
--
-- Message status is explicit and only moves forward:
--   drafted -> approved -> queued -> provider_accepted -> delivered (only on an explicit
--   provider signal) -> replied;  failed / cancelled are terminal (failed can be replayed).
-- Opens are recorded as events and never change status or health.
begin;

alter table public.crm_mail_threads
 add column if not exists assigned_to uuid references auth.users(id),
 add column if not exists state text,
 add column if not exists labels text[],
 add column if not exists reply_lock_by uuid references auth.users(id),
 add column if not exists reply_lock_until timestamptz,
 add column if not exists last_inbound_at timestamptz,
 add column if not exists last_outbound_at timestamptz,
 add column if not exists unanswered_questions jsonb;
do $$ begin
 if not exists(select 1 from pg_constraint where conname='crm_mail_threads_state_check') then
  alter table public.crm_mail_threads add constraint crm_mail_threads_state_check check(state is null or state in ('waiting_on_us','waiting_on_customer','closed'));
 end if;
end $$;

create table if not exists public.revenue_sender_identities(
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.crm_workspaces(id),
 account_id uuid,
 email text not null check(email=lower(trim(email)) and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
 display_name text not null check(length(trim(display_name)) between 1 and 120),
 reply_to text check(reply_to is null or reply_to ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
 signature text not null default '' check(length(signature)<=2000),
 is_shared boolean not null default false,
 created_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 unique(workspace_id,email)
);

create table if not exists public.revenue_templates(
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.crm_workspaces(id),
 name text not null check(length(trim(name)) between 1 and 120),
 subject text not null check(length(subject) between 1 and 300),
 body text not null check(length(body) between 1 and 20000),
 archived boolean not null default false,
 created_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);

create table if not exists public.revenue_messages(
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.crm_workspaces(id),
 customer_id uuid,
 deal_id uuid,
 account_id uuid,
 thread_id text,
 direction text not null check(direction in ('outbound','inbound')),
 purpose text not null default 'reply' check(purpose in ('reply','follow_up','transactional','marketing','onboarding','inbound')),
 status text not null check(status in ('drafted','approved','queued','provider_accepted','delivered','replied','failed','cancelled','received')),
 to_email text,
 from_email text,
 cc text,
 subject text not null default '' check(length(subject)<=500),
 body text not null default '' check(length(body)<=100000),
 sender_identity_id uuid references public.revenue_sender_identities(id),
 signature_snapshot text,
 reply_to_snapshot text,
 in_reply_to text,
 attachments jsonb not null default '[]',
 template_id uuid references public.revenue_templates(id),
 ai_generated boolean not null default false,
 untrusted boolean not null default false,
 created_by uuid references auth.users(id),
 approved_by uuid references auth.users(id),
 approved_at timestamptz,
 approval_source text check(approval_source in ('user','automation','external')),
 automation_key text,
 follow_up_of uuid references public.revenue_messages(id),
 queued_at timestamptz,
 provider_message_id text,
 provider_accepted_at timestamptz,
 delivered_at timestamptz,
 replied_at timestamptz,
 failed_at timestamptz,
 failure jsonb,
 idempotency_key text not null,
 occurred_at timestamptz not null default now(),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(workspace_id,idempotency_key),
 foreign key(workspace_id,customer_id) references public.crm_customers(workspace_id,id)
);
create unique index if not exists revenue_messages_provider on public.revenue_messages(workspace_id,account_id,provider_message_id) where provider_message_id is not null;
create index if not exists revenue_messages_thread on public.revenue_messages(workspace_id,account_id,thread_id,created_at desc);
create index if not exists revenue_messages_customer on public.revenue_messages(workspace_id,customer_id,created_at desc);
create index if not exists revenue_messages_status on public.revenue_messages(workspace_id,status,updated_at desc);

create table if not exists public.revenue_thread_comments(
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.crm_workspaces(id),
 account_id uuid not null,
 thread_id text not null,
 author_id uuid not null references auth.users(id),
 body text not null check(length(trim(body)) between 1 and 4000),
 created_at timestamptz not null default now()
);
create index if not exists revenue_thread_comments_thread on public.revenue_thread_comments(workspace_id,account_id,thread_id,created_at);

create table if not exists public.revenue_sync_state(
 workspace_id uuid not null references public.crm_workspaces(id),
 account_id uuid not null,
 provider text not null default 'gmail',
 mailbox text,
 cursor text,
 status text not null default 'unknown' check(status in ('unknown','healthy','syncing','expired','error','paused')),
 last_synced_at timestamptz,
 last_attempt_at timestamptz,
 last_error text,
 messages_synced bigint not null default 0,
 backlog integer,
 primary key(workspace_id,account_id)
);

create table if not exists public.revenue_integrations(
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.crm_workspaces(id),
 provider text not null check(provider in ('form','stripe','calendar')),
 label text not null check(length(trim(label)) between 1 and 120),
 token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
 status text not null default 'active' check(status in ('active','revoked')),
 created_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 last_success_at timestamptz,
 last_error text,
 last_error_at timestamptz
);

create table if not exists public.revenue_workflows(
 workspace_id uuid not null references public.crm_workspaces(id),
 key text not null check(key in ('inquiry_acknowledgement','follow_up_no_reply','payment_onboarding')),
 enabled boolean not null default false,
 auto_send_authorized boolean not null default false,
 authorized_by uuid references auth.users(id),
 authorized_at timestamptz,
 settings jsonb not null default '{}',
 updated_at timestamptz not null default now(),
 primary key(workspace_id,key)
);

create table if not exists public.revenue_controls(
 workspace_id uuid primary key references public.crm_workspaces(id),
 automation_paused boolean not null default false,
 paused_by uuid references auth.users(id),
 paused_at timestamptz,
 pause_reason text,
 daily_send_limit integer not null default 200 check(daily_send_limit between 0 and 10000),
 daily_spend_limit_cents bigint not null default 0 check(daily_spend_limit_cents>=0)
);

create table if not exists public.revenue_jobs(
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.crm_workspaces(id),
 kind text not null check(kind in ('mail.send','mail.follow_up','inquiry.acknowledge','onboarding.kickoff')),
 workflow_key text,
 dedupe_key text not null,
 payload jsonb not null default '{}',
 status text not null default 'queued' check(status in ('queued','running','succeeded','dead','cancelled')),
 attempts integer not null default 0,
 max_attempts integer not null default 5 check(max_attempts between 1 and 20),
 run_at timestamptz not null default now(),
 locked_by text,
 locked_until timestamptz,
 last_error text,
 cancel_reason text,
 chain_depth integer not null default 0 check(chain_depth between 0 and 3),
 parent_job_id uuid references public.revenue_jobs(id),
 customer_id uuid,
 message_id uuid references public.revenue_messages(id),
 cost_cents bigint not null default 0,
 created_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 finished_at timestamptz,
 unique(workspace_id,dedupe_key)
);
create index if not exists revenue_jobs_ready on public.revenue_jobs(status,run_at) where status in ('queued','running');
create index if not exists revenue_jobs_ws on public.revenue_jobs(workspace_id,status,updated_at desc);

create table if not exists public.revenue_job_runs(
 id bigint generated always as identity primary key,
 job_id uuid not null references public.revenue_jobs(id),
 workspace_id uuid not null,
 attempt integer not null,
 worker text,
 started_at timestamptz not null default now(),
 finished_at timestamptz,
 outcome text check(outcome in ('running','succeeded','retry','dead','cancelled','deferred','replayed')),
 error text,
 detail jsonb not null default '{}'
);
create index if not exists revenue_job_runs_job on public.revenue_job_runs(job_id,started_at);

create table if not exists revenue_private.worker_tokens(
 token_hash text primary key check(token_hash ~ '^[a-f0-9]{64}$'),
 label text not null,
 created_at timestamptz not null default now()
);
revoke all on revenue_private.worker_tokens from public, anon, authenticated;

-- ---------- helpers ----------
create or replace function revenue_private.require_worker(p_token text) returns void language plpgsql stable security definer set search_path='' as $$
begin
 if p_token is null or length(p_token)<40 or not exists(select 1 from revenue_private.worker_tokens where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex')) then
  raise exception '401:Worker is not authorized.' using errcode='42501';
 end if;
end $$;

create or replace function revenue_private.integration(p_integration uuid, p_token text, p_provider text) returns public.revenue_integrations
language plpgsql stable security definer set search_path='' as $$
declare i public.revenue_integrations;
begin
 if p_token is null or length(p_token)<40 or length(p_token)>200 then raise exception '401:Invalid integration token.' using errcode='42501'; end if;
 select * into i from public.revenue_integrations where id=p_integration and provider=p_provider and status='active' and token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
 if i.id is null then raise exception '401:Integration is not authorized.' using errcode='42501'; end if;
 return i;
end $$;

-- Returns why outbound mail to this address is blocked, or null.
create or replace function revenue_private.block_reason(p_workspace uuid, p_email text, p_purpose text) returns text
language plpgsql stable security definer set search_path='' as $$
declare em text := public.revenue_normalize_email(p_email); r text;
begin
 if em is null then return 'invalid_recipient'; end if;
 select reason into r from public.revenue_suppressions where workspace_id=p_workspace and email_canonical=em;
 if r is not null then return 'suppressed:'||r; end if;
 if exists(select 1 from public.crm_customers where workspace_id=p_workspace and suppressed and email is not null and public.revenue_normalize_email(email)=em) then return 'suppressed:customer_record'; end if;
 if p_purpose in ('marketing','follow_up') and (
   select status from public.revenue_consents k join public.crm_customers c on c.workspace_id=k.workspace_id and c.id=k.customer_id
   where k.workspace_id=p_workspace and k.channel='email' and k.purpose='marketing' and c.email is not null and public.revenue_normalize_email(c.email)=em
   order by k.recorded_at desc limit 1)='revoked' then return 'consent_revoked'; end if;
 return null;
end $$;

create or replace function revenue_private.rank(p_status text) returns integer language sql immutable set search_path='' as $$
 select case p_status when 'drafted' then 0 when 'approved' then 1 when 'queued' then 2 when 'provider_accepted' then 3 when 'delivered' then 4 when 'replied' then 5 else 9 end
$$;
create or replace function revenue_private.can_transition(p_from text, p_to text) returns boolean language sql immutable set search_path='' as $$
 select case
  when p_to='cancelled' then p_from in ('drafted','approved','queued')
  when p_to='failed' then p_from in ('approved','queued','provider_accepted','delivered')
  when p_from='failed' and p_to='queued' then true
  when p_from in ('failed','cancelled','received') then false
  else revenue_private.rank(p_to) > revenue_private.rank(p_from) and revenue_private.rank(p_to)<9 end
$$;

-- Applies a status change if it moves forward; stale or out-of-order signals are ignored.
create or replace function revenue_private.transition_message(p_message uuid, p_to text, p_patch jsonb, p_event_kind text, p_summary text, p_source text, p_actor text, p_dedupe text, p_recovery text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare m public.revenue_messages;
begin
 select * into m from public.revenue_messages where id=p_message for update;
 if m.id is null or not revenue_private.can_transition(m.status,p_to) then return false; end if;
 update public.revenue_messages set status=p_to, updated_at=now(),
  approved_by=coalesce((p_patch->>'approved_by')::uuid,approved_by), approved_at=case when p_to='approved' then now() else approved_at end,
  approval_source=coalesce(p_patch->>'approval_source',approval_source), automation_key=coalesce(p_patch->>'automation_key',automation_key),
  queued_at=case when p_to='queued' then now() else queued_at end,
  provider_message_id=coalesce(p_patch->>'provider_message_id',provider_message_id),
  thread_id=coalesce(thread_id,p_patch->>'provider_thread_id'),
  provider_accepted_at=case when p_to='provider_accepted' then coalesce((p_patch->>'at')::timestamptz,now()) else provider_accepted_at end,
  delivered_at=case when p_to='delivered' then coalesce((p_patch->>'at')::timestamptz,now()) else delivered_at end,
  replied_at=case when p_to='replied' then coalesce((p_patch->>'at')::timestamptz,now()) else replied_at end,
  failed_at=case when p_to='failed' then now() when p_to='queued' then null else failed_at end,
  failure=case when p_to in ('failed','cancelled') then p_patch->'failure' when p_to='queued' then null else failure end,
  signature_snapshot=coalesce(p_patch->>'signature',signature_snapshot), reply_to_snapshot=coalesce(p_patch->>'reply_to',reply_to_snapshot)
 where id=p_message;
 perform revenue_private.record_event(m.workspace_id,m.customer_id,m.deal_id,p_event_kind,p_source,p_actor,null,coalesce((p_patch->>'at')::timestamptz,now()),p_to,'message',m.id,
  p_summary,jsonb_build_object('to',m.to_email,'subject',m.subject,'from_status',m.status)||coalesce(p_patch->'detail','{}'),
  jsonb_build_object('thread_id',m.thread_id,'account_id',m.account_id),p_dedupe,
  case when p_to in ('failed','cancelled') then p_patch->'failure' end, p_recovery);
 return true;
end $$;

create or replace function revenue_private.enqueue(p_workspace uuid, p_kind text, p_workflow text, p_dedupe text, p_payload jsonb, p_run_at timestamptz,
 p_customer uuid, p_message uuid, p_depth integer, p_parent uuid, p_max_attempts integer default 5)
returns uuid language plpgsql security definer set search_path='' as $$
declare j uuid;
begin
 if coalesce(p_depth,0)>3 then
  raise exception '409:Automation chain limit reached; this would create a loop.';
 end if;
 insert into public.revenue_jobs(workspace_id,kind,workflow_key,dedupe_key,payload,run_at,customer_id,message_id,chain_depth,parent_job_id,max_attempts,created_by)
 values(p_workspace,p_kind,p_workflow,p_dedupe,coalesce(p_payload,'{}'),coalesce(p_run_at,now()),p_customer,p_message,coalesce(p_depth,0),p_parent,p_max_attempts,auth.uid())
 on conflict(workspace_id,dedupe_key) do nothing returning id into j;
 if j is null then select id into j from public.revenue_jobs where workspace_id=p_workspace and dedupe_key=p_dedupe; end if;
 return j;
end $$;

create or replace function revenue_private.workflow(p_workspace uuid, p_key text) returns public.revenue_workflows
language sql stable security definer set search_path='' as $$
 select * from public.revenue_workflows where workspace_id=p_workspace and key=p_key
$$;

-- Queue an approved message for sending (shared by user approval and authorized automation).
create or replace function revenue_private.queue_send(p_message uuid, p_depth integer, p_parent uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare m public.revenue_messages; j uuid;
begin
 select * into m from public.revenue_messages where id=p_message;
 j := revenue_private.enqueue(m.workspace_id,'mail.send',m.automation_key,'mail.send:'||m.id,jsonb_build_object('message_id',m.id),now(),m.customer_id,m.id,p_depth,p_parent);
 perform revenue_private.transition_message(m.id,'queued',jsonb_build_object('detail',jsonb_build_object('job_id',j)),'email.queued','Queued for sending','automation','system','email.queued:'||m.id||':'||coalesce(m.failed_at::text,'first'));
 return j;
end $$;

-- Approved or queued sends to a newly suppressed address stop with a visible reason.
create or replace function revenue_private.cancel_for_recipient(p_workspace uuid, p_email text, p_reason text) returns integer
language plpgsql security definer set search_path='' as $$
declare x uuid; n integer := 0;
begin
 for x in select id from public.revenue_messages where workspace_id=p_workspace and direction='outbound' and status in ('approved','queued') and public.revenue_normalize_email(to_email)=p_email loop
  perform revenue_private.transition_message(x,'cancelled',jsonb_build_object('failure',jsonb_build_object('reason',p_reason)),'email.cancelled','Send stopped: recipient '||p_reason,'mail','system','email.cancelled:'||x,
   'Review consent and suppression before contacting this customer.');
  update public.revenue_jobs set status='cancelled',cancel_reason='Recipient '||p_reason,finished_at=now(),updated_at=now() where message_id=x and status='queued';
  n := n+1;
 end loop;
 return n;
end $$;

-- ---------- Onixus Mail: user actions ----------
create or replace function public.revenue_draft_message(p_workspace uuid, p_draft jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid := revenue_private.require_role(p_workspace,'member'); m uuid; c uuid := (p_draft->>'customer_id')::uuid; to_addr text := lower(trim(p_draft->>'to'));
 block text; ident public.revenue_sender_identities; k text := coalesce(p_draft->>'idempotency_key','draft:'||gen_random_uuid());
begin
 if to_addr is null or public.revenue_normalize_email(to_addr) is null then raise exception '400:Enter a valid recipient.'; end if;
 if c is not null and not exists(select 1 from public.crm_customers where workspace_id=p_workspace and id=c) then raise exception '404:Customer not found.'; end if;
 if (p_draft->>'sender_identity_id') is not null then
  select * into ident from public.revenue_sender_identities where workspace_id=p_workspace and id=(p_draft->>'sender_identity_id')::uuid;
  if ident.id is null then raise exception '400:Choose a sender identity from this workspace.'; end if;
 end if;
 if (p_draft->>'template_id') is not null and not exists(select 1 from public.revenue_templates where workspace_id=p_workspace and id=(p_draft->>'template_id')::uuid) then
  raise exception '400:Choose a template from this workspace.';
 end if;
 select id into m from public.revenue_messages where workspace_id=p_workspace and idempotency_key=k;
 if m is not null then return jsonb_build_object('message_id',m,'status',(select status from public.revenue_messages where id=m),'duplicate',true); end if;
 insert into public.revenue_messages(workspace_id,customer_id,deal_id,account_id,thread_id,direction,purpose,status,to_email,from_email,cc,subject,body,sender_identity_id,in_reply_to,attachments,template_id,ai_generated,created_by,idempotency_key,follow_up_of)
 values(p_workspace,c,(p_draft->>'deal_id')::uuid,coalesce((p_draft->>'account_id')::uuid,ident.account_id),nullif(p_draft->>'thread_id',''),'outbound',coalesce(p_draft->>'purpose','reply'),'drafted',to_addr,ident.email,p_draft->>'cc',
        left(coalesce(p_draft->>'subject',''),500),coalesce(p_draft->>'body',''),ident.id,p_draft->>'in_reply_to',coalesce(p_draft->'attachments','[]'),(p_draft->>'template_id')::uuid,
        coalesce((p_draft->>'ai_generated')::boolean,false),u,k,(p_draft->>'follow_up_of')::uuid)
 returning id into m;
 block := revenue_private.block_reason(p_workspace,to_addr,coalesce(p_draft->>'purpose','reply'));
 perform revenue_private.record_event(p_workspace,c,(p_draft->>'deal_id')::uuid,'email.drafted','mail','user',null,now(),'drafted','message',m,
  case when coalesce((p_draft->>'ai_generated')::boolean,false) then 'Onyx drafted a reply for review' else 'Reply drafted' end||': '||left(coalesce(p_draft->>'subject',''),200),
  jsonb_build_object('to',to_addr,'blocked',block),jsonb_build_object('thread_id',p_draft->>'thread_id','account_id',p_draft->>'account_id'),'email.drafted:'||m);
 return jsonb_build_object('message_id',m,'status','drafted','blocked_reason',block,'duplicate',false);
end $$;

create or replace function public.revenue_update_draft(p_workspace uuid, p_message uuid, p_subject text, p_body text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid := revenue_private.require_role(p_workspace,'member');
begin
 update public.revenue_messages set subject=left(p_subject,500), body=p_body, updated_at=now() where workspace_id=p_workspace and id=p_message and status='drafted' and direction='outbound';
 if not found then raise exception '409:Only drafts can be edited.'; end if;
 return jsonb_build_object('message_id',p_message,'status','drafted');
end $$;

create or replace function public.revenue_approve_message(p_workspace uuid, p_message uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid := revenue_private.require_role(p_workspace,'member'); m public.revenue_messages; block text; t public.crm_mail_threads; other uuid; ident public.revenue_sender_identities; j uuid;
begin
 select * into m from public.revenue_messages where workspace_id=p_workspace and id=p_message and direction='outbound' for update;
 if m.id is null then raise exception '404:Message not found.'; end if;
 if m.status<>'drafted' then raise exception '409:This message is already %.', m.status; end if;
 block := revenue_private.block_reason(p_workspace,m.to_email,m.purpose);
 if block is not null then
  perform revenue_private.record_event(p_workspace,m.customer_id,m.deal_id,'email.blocked','mail','system',null,now(),'drafted','message',m.id,
   'Send blocked: recipient is '||replace(block,'_',' '),jsonb_build_object('reason',block),'{}','email.blocked:'||m.id||':'||block,
   jsonb_build_object('reason',block),'Review consent and suppression before contacting this customer.');
  raise exception '409:Sending is blocked for this recipient (%).', replace(block,'_',' ');
 end if;
 if m.thread_id is not null and m.account_id is not null then
  perform pg_advisory_xact_lock(hashtextextended('revenue-thread:'||p_workspace||':'||m.account_id||':'||m.thread_id,0));
  select * into t from public.crm_mail_threads where workspace_id=p_workspace and account_id=m.account_id and thread_id=m.thread_id;
  if t.reply_lock_by is not null and t.reply_lock_by<>u and t.reply_lock_until>now() then
   raise exception '409:Another teammate is replying to this conversation.';
  end if;
  select id into other from public.revenue_messages where workspace_id=p_workspace and account_id=m.account_id and thread_id=m.thread_id and id<>m.id and direction='outbound'
   and status in ('approved','queued','provider_accepted','delivered') and coalesce(approved_at,created_at) > coalesce(t.last_inbound_at,'-infinity'::timestamptz) limit 1;
  if other is not null then raise exception '409:A reply to the latest customer message is already approved or sent.'; end if;
 end if;
 select * into ident from public.revenue_sender_identities where id=m.sender_identity_id;
 perform revenue_private.transition_message(m.id,'approved',jsonb_build_object('approved_by',u,'approval_source','user','signature',ident.signature,'reply_to',ident.reply_to),
  'email.approved','Approved for sending','mail','user','email.approved:'||m.id);
 j := revenue_private.queue_send(m.id,0,null);
 perform revenue_private.audit(p_workspace,'user','message.approve','message',m.id::text,jsonb_build_object('job_id',j));
 return jsonb_build_object('message_id',m.id,'status','queued','job_id',j);
end $$;

create or replace function public.revenue_cancel_message(p_workspace uuid, p_message uuid, p_reason text default 'Cancelled by a workspace member')
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid := revenue_private.require_role(p_workspace,'member'); ok boolean;
begin
 if not exists(select 1 from public.revenue_messages where workspace_id=p_workspace and id=p_message) then raise exception '404:Message not found.'; end if;
 ok := revenue_private.transition_message(p_message,'cancelled',jsonb_build_object('failure',jsonb_build_object('reason','cancelled','detail',left(p_reason,300))),'email.cancelled','Message cancelled','mail','user','email.cancelled:'||p_message);
 if not ok then raise exception '409:This message can no longer be cancelled.'; end if;
 update public.revenue_jobs set status='cancelled',cancel_reason=p_reason,finished_at=now(),updated_at=now() where workspace_id=p_workspace and message_id=p_message and status='queued';
 return jsonb_build_object('message_id',p_message,'status','cancelled');
end $$;

-- Retry a failed send after the cause is fixed (e.g. Google reconnected).
create or replace function public.revenue_retry_message(p_workspace uuid, p_message uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid := revenue_private.require_role(p_workspace,'member'); m public.revenue_messages; block text;
begin
 select * into m from public.revenue_messages where workspace_id=p_workspace and id=p_message for update;
 if m.id is null or m.status<>'failed' then raise exception '409:Only failed messages can be retried.'; end if;
 if m.failure->>'reason'='bounce' then raise exception '409:The address bounced. Verify it before contacting this customer again.'; end if;
 block := revenue_private.block_reason(p_workspace,m.to_email,m.purpose);
 if block is not null then raise exception '409:Sending is blocked for this recipient (%).', replace(block,'_',' '); end if;
 update public.revenue_jobs set status='queued',attempts=0,run_at=now(),last_error=null,finished_at=null,updated_at=now() where workspace_id=p_workspace and message_id=p_message and kind='mail.send';
 insert into public.revenue_job_runs(job_id,workspace_id,attempt,outcome,detail) select id,workspace_id,0,'replayed',jsonb_build_object('by',u) from public.revenue_jobs where workspace_id=p_workspace and message_id=p_message and kind='mail.send';
 perform revenue_private.transition_message(m.id,'queued','{}','email.queued','Retry queued after failure','mail','user','email.retry:'||m.id||':'||m.failed_at::text);
 return jsonb_build_object('message_id',m.id,'status','queued');
end $$;

create or replace function public.revenue_thread_action(p_workspace uuid, p_account uuid, p_thread text, p_action text, p_value jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid := revenue_private.require_role(p_workspace,'member'); t public.crm_mail_threads; c uuid;
begin
 select * into t from public.crm_mail_threads where workspace_id=p_workspace and account_id=p_account and thread_id=p_thread for update;
 if t.thread_id is null then raise exception '404:Conversation not found.'; end if;
 if p_action='claim' then
  if t.reply_lock_by is not null and t.reply_lock_by<>u and t.reply_lock_until>now() then raise exception '409:Another teammate is replying to this conversation.'; end if;
  update public.crm_mail_threads set reply_lock_by=u, reply_lock_until=now()+make_interval(mins=>least(greatest(coalesce((p_value->>'minutes')::integer,15),1),60)) where workspace_id=p_workspace and account_id=p_account and thread_id=p_thread;
 elsif p_action='release' then
  update public.crm_mail_threads set reply_lock_by=null, reply_lock_until=null where workspace_id=p_workspace and account_id=p_account and thread_id=p_thread and reply_lock_by=u;
 elsif p_action='assign' then
  if (p_value->>'owner') is not null and not exists(select 1 from public.crm_memberships where workspace_id=p_workspace and user_id=(p_value->>'owner')::uuid and role in ('owner','member')) then raise exception '400:Assign to a workspace owner or member.'; end if;
  update public.crm_mail_threads set assigned_to=(p_value->>'owner')::uuid where workspace_id=p_workspace and account_id=p_account and thread_id=p_thread;
 elsif p_action='label' then
  update public.crm_mail_threads set labels=(select array_agg(distinct left(trim(x),40)) from jsonb_array_elements_text(p_value->'labels') x where trim(x)<>'') where workspace_id=p_workspace and account_id=p_account and thread_id=p_thread;
 elsif p_action='close' then
  update public.crm_mail_threads set state='closed' where workspace_id=p_workspace and account_id=p_account and thread_id=p_thread;
 elsif p_action='comment' then
  insert into public.revenue_thread_comments(workspace_id,account_id,thread_id,author_id,body) values(p_workspace,p_account,p_thread,u,p_value->>'body') returning id into c;
 else raise exception '400:Unsupported conversation action.'; end if;
 perform revenue_private.audit(p_workspace,'user','thread.'||p_action,'thread',p_account||':'||p_thread,p_value);
 return jsonb_build_object('ok',true,'comment_id',c);
end $$;

create or replace function public.revenue_schedule_follow_up(p_workspace uuid, p_message uuid, p_run_at timestamptz, p_body text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid := revenue_private.require_role(p_workspace,'member'); m public.revenue_messages; j uuid;
begin
 select * into m from public.revenue_messages where workspace_id=p_workspace and id=p_message and direction='outbound';
 if m.id is null then raise exception '404:Message not found.'; end if;
 if p_run_at<=now() then raise exception '400:Choose a future follow-up time.'; end if;
 if length(trim(coalesce(p_body,'')))=0 then raise exception '400:Enter the follow-up text.'; end if;
 j := revenue_private.enqueue(p_workspace,'mail.follow_up','follow_up_no_reply','follow_up:'||m.id||':'||extract(epoch from p_run_at)::bigint,
  jsonb_build_object('source_message_id',m.id,'account_id',m.account_id,'thread_id',m.thread_id,'body',p_body,'scheduled_at',now()),p_run_at,m.customer_id,m.id,0,null);
 perform revenue_private.record_event(p_workspace,m.customer_id,m.deal_id,'follow_up.scheduled','mail','user',null,now(),'scheduled','job',j,
  'Follow-up scheduled for '||to_char(p_run_at at time zone 'UTC','YYYY-MM-DD HH24:MI')||' UTC (stops if the customer replies)','{}',jsonb_build_object('message_id',m.id),'follow_up.scheduled:'||j);
 return jsonb_build_object('job_id',j,'run_at',p_run_at);
end $$;

create or replace function public.revenue_save_template(p_workspace uuid, p_id uuid, p_name text, p_subject text, p_body text, p_archived boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid := revenue_private.require_role(p_workspace,'member'); t uuid;
begin
 if p_id is null then
  insert into public.revenue_templates(workspace_id,name,subject,body,created_by) values(p_workspace,p_name,p_subject,p_body,u) returning id into t;
 else
  update public.revenue_templates set name=p_name,subject=p_subject,body=p_body,archived=coalesce(p_archived,false),updated_at=now() where workspace_id=p_workspace and id=p_id returning id into t;
  if t is null then raise exception '404:Template not found.'; end if;
 end if;
 return jsonb_build_object('template_id',t);
end $$;

create or replace function public.revenue_save_sender_identity(p_workspace uuid, p_email text, p_display_name text, p_reply_to text, p_signature text, p_shared boolean, p_account uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid := revenue_private.require_role(p_workspace,'owner'); i uuid;
begin
 insert into public.revenue_sender_identities(workspace_id,account_id,email,display_name,reply_to,signature,is_shared,created_by)
 values(p_workspace,p_account,lower(trim(p_email)),p_display_name,nullif(lower(trim(p_reply_to)),''),coalesce(p_signature,''),coalesce(p_shared,false),u)
 on conflict(workspace_id,email) do update set display_name=excluded.display_name,reply_to=excluded.reply_to,signature=excluded.signature,is_shared=excluded.is_shared,account_id=coalesce(excluded.account_id,public.revenue_sender_identities.account_id)
 returning id into i;
 perform revenue_private.audit(p_workspace,'user','sender_identity.save','sender_identity',i::text,'{}');
 return jsonb_build_object('sender_identity_id',i);
end $$;

create or replace function public.revenue_suppress(p_workspace uuid, p_email text, p_reason text, p_detail text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid := revenue_private.require_role(p_workspace,'member'); em text := public.revenue_normalize_email(p_email); n integer;
begin
 if em is null then raise exception '400:Enter a valid email address.'; end if;
 insert into public.revenue_suppressions(workspace_id,email_canonical,reason,source,detail,created_by) values(p_workspace,em,coalesce(p_reason,'manual'),'crm',p_detail,u) on conflict(workspace_id,email_canonical) do nothing;
 with x as (update public.revenue_jobs j set status='cancelled',cancel_reason='Recipient suppressed',finished_at=now(),updated_at=now()
  from public.revenue_messages m where j.workspace_id=p_workspace and j.message_id=m.id and j.status='queued' and public.revenue_normalize_email(m.to_email)=em returning j.id) select count(*) into n from x;
 perform revenue_private.cancel_for_recipient(p_workspace,em,'suppressed');
 perform revenue_private.audit(p_workspace,'user','suppression.add','email',em,jsonb_build_object('reason',p_reason,'cancelled_jobs',n));
 return jsonb_build_object('suppressed',em,'cancelled_jobs',n);
end $$;
create or replace function public.revenue_unsuppress(p_workspace uuid, p_email text, p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid := revenue_private.require_role(p_workspace,'owner'); em text := public.revenue_normalize_email(p_email);
begin
 if length(trim(coalesce(p_reason,'')))<5 then raise exception '400:Record why this address may be contacted again.'; end if;
 delete from public.revenue_suppressions where workspace_id=p_workspace and email_canonical=em;
 perform revenue_private.audit(p_workspace,'user','suppression.remove','email',em,jsonb_build_object('reason',p_reason));
 return jsonb_build_object('unsuppressed',em);
end $$;

-- ---------- workspace controls and workflows (owners) ----------
create or replace function public.revenue_set_controls(p_workspace uuid, p_paused boolean, p_reason text default null, p_daily_send_limit integer default null, p_daily_spend_limit_cents bigint default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid := revenue_private.require_role(p_workspace,'owner');
begin
 insert into public.revenue_controls(workspace_id) values(p_workspace) on conflict do nothing;
 update public.revenue_controls set automation_paused=coalesce(p_paused,automation_paused),
  paused_by=case when p_paused then u else null end, paused_at=case when p_paused then now() else null end, pause_reason=case when p_paused then p_reason else null end,
  daily_send_limit=coalesce(p_daily_send_limit,daily_send_limit), daily_spend_limit_cents=coalesce(p_daily_spend_limit_cents,daily_spend_limit_cents)
 where workspace_id=p_workspace;
 perform revenue_private.audit(p_workspace,'user',case when p_paused then 'automation.pause' else 'automation.controls' end,'workspace',p_workspace::text,jsonb_build_object('reason',p_reason,'send_limit',p_daily_send_limit));
 return (select to_jsonb(c) from public.revenue_controls c where workspace_id=p_workspace);
end $$;

create or replace function public.revenue_set_workflow(p_workspace uuid, p_key text, p_enabled boolean, p_auto_send boolean, p_settings jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid := revenue_private.require_role(p_workspace,'owner');
begin
 insert into public.revenue_workflows(workspace_id,key,enabled,auto_send_authorized,authorized_by,authorized_at,settings)
 values(p_workspace,p_key,p_enabled,coalesce(p_auto_send,false),case when p_auto_send then u end,case when p_auto_send then now() end,coalesce(p_settings,'{}'))
 on conflict(workspace_id,key) do update set enabled=excluded.enabled,auto_send_authorized=excluded.auto_send_authorized,authorized_by=excluded.authorized_by,authorized_at=excluded.authorized_at,settings=excluded.settings,updated_at=now();
 perform revenue_private.audit(p_workspace,'user','workflow.set','workflow',p_key,jsonb_build_object('enabled',p_enabled,'auto_send',p_auto_send));
 return jsonb_build_object('key',p_key,'enabled',p_enabled,'auto_send_authorized',coalesce(p_auto_send,false));
end $$;

create or replace function public.revenue_job_action(p_workspace uuid, p_job uuid, p_action text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid := revenue_private.require_role(p_workspace,'member'); j public.revenue_jobs; m public.revenue_messages;
begin
 select * into j from public.revenue_jobs where workspace_id=p_workspace and id=p_job for update;
 if j.id is null then raise exception '404:Job not found.'; end if;
 if p_action='cancel' then
  if j.status<>'queued' then raise exception '409:Only queued jobs can be cancelled.'; end if;
  update public.revenue_jobs set status='cancelled',cancel_reason=coalesce(p_reason,'Cancelled by a workspace member'),finished_at=now(),updated_at=now() where id=p_job;
  if j.message_id is not null and j.kind='mail.send' then
   perform revenue_private.transition_message(j.message_id,'cancelled',jsonb_build_object('failure',jsonb_build_object('reason','cancelled')),'email.cancelled','Send cancelled','automation','user','email.cancelled:'||j.message_id);
  end if;
 elsif p_action='replay' then
  if j.status not in ('dead','cancelled') then raise exception '409:Only failed or cancelled jobs can be replayed.'; end if;
  if j.kind='mail.send' then
   select * into m from public.revenue_messages where id=j.message_id;
   if m.status='failed' then return public.revenue_retry_message(p_workspace,m.id); end if;
   if m.status<>'queued' then raise exception '409:The message is % and cannot be replayed.', m.status; end if;
  end if;
  update public.revenue_jobs set status='queued',attempts=0,run_at=now(),last_error=null,cancel_reason=null,finished_at=null,updated_at=now() where id=p_job;
  insert into public.revenue_job_runs(job_id,workspace_id,attempt,outcome,detail) values(p_job,p_workspace,0,'replayed',jsonb_build_object('by',u));
 else raise exception '400:Unsupported job action.'; end if;
 perform revenue_private.audit(p_workspace,'user','job.'||p_action,'job',p_job::text,jsonb_build_object('reason',p_reason));
 return jsonb_build_object('job_id',p_job,'action',p_action);
end $$;

create or replace function public.revenue_create_integration(p_workspace uuid, p_provider text, p_label text, p_token_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid := revenue_private.require_role(p_workspace,'owner'); i uuid;
begin
 insert into public.revenue_integrations(workspace_id,provider,label,token_hash,created_by) values(p_workspace,p_provider,p_label,p_token_hash,u) returning id into i;
 perform revenue_private.audit(p_workspace,'user','integration.create','integration',i::text,jsonb_build_object('provider',p_provider));
 return jsonb_build_object('integration_id',i);
end $$;
create or replace function public.revenue_revoke_integration(p_workspace uuid, p_integration uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid := revenue_private.require_role(p_workspace,'owner');
begin
 update public.revenue_integrations set status='revoked' where workspace_id=p_workspace and id=p_integration;
 if not found then raise exception '404:Integration not found.'; end if;
 perform revenue_private.audit(p_workspace,'user','integration.revoke','integration',p_integration::text,'{}');
 return jsonb_build_object('revoked',true);
end $$;

-- ---------- Onixus Mail service ingestion (account-bound token, existing pattern) ----------
create or replace function public.revenue_ingest_mail_event(p_account uuid, p_token text, p_event jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare w uuid := crm_private.mail_workspace(p_account,p_token); ty text := p_event->>'type'; r jsonb; c uuid; m uuid; prior public.revenue_messages;
 th text := nullif(p_event->>'thread_id',''); pid text := nullif(p_event->>'provider_message_id',''); at timestamptz := coalesce((p_event->>'occurred_at')::timestamptz,now());
 n integer; em text; t public.crm_mail_threads; j record;
begin
 if at>now()+interval '10 minutes' then raise exception '400:Event time is in the future.'; end if;
 if ty='message.inbound' then
  if pid is null or th is null then raise exception '400:Inbound messages need provider message and thread ids.'; end if;
  if exists(select 1 from public.revenue_messages where workspace_id=w and account_id=p_account and provider_message_id=pid) then return jsonb_build_object('duplicate',true); end if;
  select * into t from public.crm_mail_threads where workspace_id=w and account_id=p_account and thread_id=th;
  if coalesce((p_event->>'automated')::boolean,false) then
   if t.thread_id is null then return jsonb_build_object('ignored','automated_sender_without_customer_thread'); end if;
   c := t.customer_id;
  elsif t.thread_id is not null then
   c := t.customer_id;
  else
   r := revenue_private.resolve_identity(w,p_event->>'from_email',null,p_event->>'from_name',null,'Onixus Mail',jsonb_build_object('account_id',p_account,'thread_id',th));
   c := (r->>'customer_id')::uuid;
  end if;
  insert into public.revenue_messages(workspace_id,customer_id,account_id,thread_id,direction,purpose,status,to_email,from_email,subject,body,in_reply_to,attachments,untrusted,provider_message_id,idempotency_key,occurred_at)
  values(w,c,p_account,th,'inbound','inbound','received',lower(p_event->>'to'),lower(p_event->>'from_email'),left(coalesce(p_event->>'subject',''),500),left(coalesce(p_event->>'text',''),100000),
         p_event->>'in_reply_to',coalesce(p_event->'attachments','[]'),true,pid,'inbound:'||p_account||':'||pid,at) returning id into m;
  insert into public.crm_mail_threads(account_id,thread_id,workspace_id,customer_id,subject,last_event_at,state,last_inbound_at,unanswered_questions)
  values(p_account,th,w,c,left(coalesce(p_event->>'subject',''),500),at,'waiting_on_us',at,p_event->'analysis'->'questions')
  on conflict(workspace_id,account_id,thread_id) do update set last_event_at=greatest(public.crm_mail_threads.last_event_at,excluded.last_event_at),
   last_inbound_at=greatest(coalesce(public.crm_mail_threads.last_inbound_at,excluded.last_inbound_at),excluded.last_inbound_at),
   state=case when excluded.last_inbound_at>=coalesce(public.crm_mail_threads.last_outbound_at,'-infinity') then 'waiting_on_us' else public.crm_mail_threads.state end,
   unanswered_questions=coalesce(excluded.unanswered_questions,public.crm_mail_threads.unanswered_questions);
  perform revenue_private.record_event(w,c,null,'email.received','gmail','customer',p_event->>'from_email',at,'received','message',m,
   'Email received: '||left(coalesce(p_event->>'subject','(no subject)'),300),
   jsonb_build_object('from',p_event->>'from_email','automated',coalesce((p_event->>'automated')::boolean,false),'questions',coalesce(p_event->'analysis'->'questions','[]'),'identity',r,'untrusted_content',true),
   jsonb_build_object('thread_id',th,'account_id',p_account),'email.received:'||p_account||':'||pid);
  -- A reply marks our latest sent message as replied and stops pending follow-ups.
  if not coalesce((p_event->>'automated')::boolean,false) then
   for prior in select * from public.revenue_messages where workspace_id=w and account_id=p_account and thread_id=th and direction='outbound' and status in ('provider_accepted','delivered') and coalesce(provider_accepted_at,created_at)<=at loop
    perform revenue_private.transition_message(prior.id,'replied',jsonb_build_object('at',at),'email.replied','Customer replied','gmail','customer','email.replied:'||prior.id);
   end loop;
   for j in update public.revenue_jobs set status='cancelled',cancel_reason='Customer replied',finished_at=now(),updated_at=now()
     where workspace_id=w and kind='mail.follow_up' and status='queued' and (payload->>'thread_id'=th or customer_id=c) returning id,customer_id loop
    perform revenue_private.record_event(w,j.customer_id,null,'follow_up.cancelled','automation','system',null,now(),'cancelled','job',j.id,'Follow-up stopped because the customer replied','{}','{}','follow_up.cancelled:'||j.id);
   end loop;
   for prior in select * from public.revenue_messages where workspace_id=w and purpose='follow_up' and status in ('drafted','approved','queued') and (thread_id=th or customer_id=c) loop
    perform revenue_private.transition_message(prior.id,'cancelled',jsonb_build_object('failure',jsonb_build_object('reason','customer_replied')),'email.cancelled','Follow-up cancelled because the customer replied','automation','system','email.cancelled:'||prior.id);
    update public.revenue_jobs set status='cancelled',cancel_reason='Customer replied',finished_at=now(),updated_at=now() where message_id=prior.id and status='queued';
   end loop;
   if c is not null then
    insert into public.crm_tasks(workspace_id,customer_id,title,due_at,kind,action_key,source_event_id)
    values(w,c,left('Reply: '||coalesce(nullif(p_event->>'subject',''),'customer email'),300),at+interval '1 day','follow_up',md5('reply:'||p_account||':'||th)::uuid,null)
    on conflict(workspace_id,action_key) do update set status='open',due_at=least(public.crm_tasks.due_at,excluded.due_at),completed_at=null;
   end if;
  end if;
  return jsonb_build_object('duplicate',false,'message_id',m,'customer_id',c,'identity',r);
 elsif ty='message.outbound_observed' then
  if pid is null then raise exception '400:Provider message id required.'; end if;
  if exists(select 1 from public.revenue_messages where workspace_id=w and account_id=p_account and provider_message_id=pid) then return jsonb_build_object('duplicate',true); end if;
  select customer_id into c from public.crm_mail_threads where workspace_id=w and account_id=p_account and thread_id=th;
  insert into public.revenue_messages(workspace_id,customer_id,account_id,thread_id,direction,purpose,status,to_email,from_email,subject,body,approval_source,provider_message_id,provider_accepted_at,idempotency_key,occurred_at)
  values(w,c,p_account,th,'outbound','reply','provider_accepted',lower(p_event->>'to'),lower(p_event->>'from_email'),left(coalesce(p_event->>'subject',''),500),left(coalesce(p_event->>'text',''),100000),'external',pid,at,'observed:'||p_account||':'||pid,at) returning id into m;
  update public.crm_mail_threads set last_outbound_at=greatest(coalesce(last_outbound_at,at),at),state='waiting_on_customer',last_event_at=greatest(last_event_at,at) where workspace_id=w and account_id=p_account and thread_id=th;
  perform revenue_private.record_event(w,c,null,'email.sent_outside','gmail','user','Sent from the mailbox directly',at,'provider_accepted','message',m,'Reply sent from Gmail directly (not through Onixus Mail)','{}',jsonb_build_object('thread_id',th),'email.observed:'||p_account||':'||pid);
  return jsonb_build_object('duplicate',false,'message_id',m);
 elsif ty='message.bounced' then
  em := public.revenue_normalize_email(p_event->>'recipient');
  select * into prior from public.revenue_messages where workspace_id=w and account_id=p_account and direction='outbound' and status in ('provider_accepted','delivered','queued')
   and ((pid is not null and provider_message_id=pid) or (pid is null and public.revenue_normalize_email(to_email)=em)) order by created_at desc limit 1;
  if prior.id is null then return jsonb_build_object('ignored','no_matching_message'); end if;
  perform revenue_private.transition_message(prior.id,'failed',jsonb_build_object('at',at,'failure',jsonb_build_object('reason','bounce','status',p_event->>'status','detail',left(p_event->>'diagnostic',300))),
   'email.bounced','Delivery failed (bounce '||coalesce(p_event->>'status','unknown')||')','gmail','provider','email.bounced:'||prior.id,'Verify the address or reach the customer another way. The address is suppressed until reviewed.');
  if coalesce(p_event->>'status','5') like '5%' and em is not null then
   insert into public.revenue_suppressions(workspace_id,email_canonical,reason,source,detail) values(w,em,'bounce','Onixus Mail',p_event->>'status') on conflict do nothing;
  end if;
  return jsonb_build_object('message_id',prior.id,'status','failed');
 elsif ty='message.delivered' then
  select * into prior from public.revenue_messages where workspace_id=w and account_id=p_account and provider_message_id=pid;
  if prior.id is null then return jsonb_build_object('ignored','no_matching_message'); end if;
  perform revenue_private.transition_message(prior.id,'delivered',jsonb_build_object('at',at,'detail',jsonb_build_object('signal',p_event->>'signal')),'email.delivered','Delivery confirmed by the provider','gmail','provider','email.delivered:'||prior.id);
  return jsonb_build_object('message_id',prior.id);
 elsif ty='message.opened' then
  select * into prior from public.revenue_messages where workspace_id=w and account_id=p_account and provider_message_id=pid;
  if prior.id is null then return jsonb_build_object('ignored','no_matching_message'); end if;
  perform revenue_private.record_event(w,prior.customer_id,prior.deal_id,'email.opened','gmail','provider',null,at,'recorded','message',prior.id,
   'Open pixel loaded (not proof that a person read it)',jsonb_build_object('engagement_evidence',false),'{}','email.opened:'||prior.id||':'||at::text);
  return jsonb_build_object('message_id',prior.id,'recorded',true);
 elsif ty='unsubscribe' then
  em := public.revenue_normalize_email(p_event->>'email');
  if em is null then raise exception '400:Invalid email.'; end if;
  insert into public.revenue_suppressions(workspace_id,email_canonical,reason,source,detail) values(w,em,'unsubscribe','Onixus Mail',p_event->>'method') on conflict do nothing;
  update public.revenue_jobs rj set status='cancelled',cancel_reason='Recipient unsubscribed',finished_at=now(),updated_at=now()
   from public.revenue_messages x where rj.workspace_id=w and rj.message_id=x.id and rj.status='queued' and public.revenue_normalize_email(x.to_email)=em;
  perform revenue_private.cancel_for_recipient(w,em,'unsubscribed');
  select id into c from public.crm_customers where workspace_id=w and merged_into_id is null and email is not null and public.revenue_normalize_email(email)=em order by created_at limit 1;
  if c is not null then
   insert into public.revenue_consents(workspace_id,customer_id,channel,purpose,status,source,evidence) values(w,c,'email','marketing','revoked','Onixus Mail unsubscribe',p_event->>'method');
   perform revenue_private.record_event(w,c,null,'consent.revoked','mail','customer',null,at,'recorded','customer',c,'Customer unsubscribed from email','{}','{}','unsubscribe:'||em||':'||at::date);
  end if;
  return jsonb_build_object('suppressed',em);
 elsif ty='sync.status' then
  insert into public.revenue_sync_state(workspace_id,account_id,provider,mailbox,cursor,status,last_synced_at,last_attempt_at,last_error,messages_synced,backlog)
  values(w,p_account,coalesce(p_event->>'provider','gmail'),p_event->>'mailbox',p_event->>'cursor',p_event->>'status',case when p_event->>'status'='healthy' then at end,at,left(p_event->>'error',500),coalesce((p_event->>'messages_synced')::bigint,0),(p_event->>'backlog')::integer)
  on conflict(workspace_id,account_id) do update set status=excluded.status, mailbox=coalesce(excluded.mailbox,public.revenue_sync_state.mailbox),
   cursor=coalesce(excluded.cursor,public.revenue_sync_state.cursor), last_synced_at=coalesce(excluded.last_synced_at,public.revenue_sync_state.last_synced_at),
   last_attempt_at=excluded.last_attempt_at, last_error=excluded.last_error, messages_synced=public.revenue_sync_state.messages_synced+excluded.messages_synced, backlog=excluded.backlog;
  if p_event->>'status' in ('expired','error') then
   perform revenue_private.record_event(w,null,null,'sync.'||(p_event->>'status'),'mail','provider',null,at,'failed','mail_account',p_account,
    case when p_event->>'status'='expired' then 'Google connection expired; Mail sync stopped' else 'Mail sync failed' end,
    jsonb_build_object('error',left(p_event->>'error',300)),'{}','sync.'||(p_event->>'status')||':'||p_account||':'||to_char(at,'YYYY-MM-DD"T"HH24'),
    jsonb_build_object('error',left(p_event->>'error',300)),
    case when p_event->>'status'='expired' then 'Reconnect Google in Onixus Mail. Sync resumes from the saved position.' else 'Retry sync. If it keeps failing, check the Mail service logs.' end);
  end if;
  return jsonb_build_object('status',p_event->>'status');
 end if;
 raise exception '400:Unsupported Mail event.';
end $$;

-- ---------- worker ----------
-- p_send=false lets a worker without a mail provider run internal jobs and leave sends queued.
create or replace function public.revenue_worker_claim(p_token text, p_worker text, p_limit integer default 10, p_send boolean default true)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.revenue_jobs; out jsonb := '[]'; m public.revenue_messages; ctl public.revenue_controls; block text; sent integer; spent bigint;
 wf public.revenue_workflows; nm uuid; nj uuid; ident public.revenue_sender_identities; replied boolean; src public.revenue_messages; processed jsonb := '[]';
begin
 perform revenue_private.require_worker(p_token);
 -- Expired leases go back to the queue; the attempt already counted.
 update public.revenue_jobs set status='queued',locked_by=null,locked_until=null,last_error='Worker lease expired; retrying',updated_at=now()
  where status='running' and locked_until<now();
 for j in select * from public.revenue_jobs where status='queued' and run_at<=now() order by run_at limit greatest(1,least(p_limit,50))*4 for update skip locked loop
  exit when jsonb_array_length(out)>=greatest(1,least(p_limit,50));
  continue when j.kind='mail.send' and not coalesce(p_send,true);
  select * into ctl from public.revenue_controls where workspace_id=j.workspace_id;
  if coalesce(ctl.automation_paused,false) then
   update public.revenue_jobs set last_error='Workspace automation is paused',updated_at=now() where id=j.id and last_error is distinct from 'Workspace automation is paused';
   continue;
  end if;
  if j.cost_cents>0 then
   select coalesce(sum(cost_cents),0) into spent from public.revenue_jobs where workspace_id=j.workspace_id and status='succeeded' and finished_at>=date_trunc('day',now());
   if spent+j.cost_cents>coalesce(ctl.daily_spend_limit_cents,0) then
    update public.revenue_jobs set run_at=date_trunc('day',now())+interval '1 day',last_error='Daily spending limit reached',updated_at=now() where id=j.id;
    insert into public.revenue_job_runs(job_id,workspace_id,attempt,worker,finished_at,outcome,error) values(j.id,j.workspace_id,j.attempts,p_worker,now(),'deferred','Daily spending limit reached');
    continue;
   end if;
  end if;
  if j.kind='mail.send' then
   select * into m from public.revenue_messages where id=j.message_id for update;
   if m.status<>'queued' then
    update public.revenue_jobs set status='cancelled',cancel_reason='Message is '||m.status,finished_at=now(),updated_at=now() where id=j.id;
    continue;
   end if;
   block := revenue_private.block_reason(j.workspace_id,m.to_email,m.purpose);
   if block is not null then
    update public.revenue_jobs set status='cancelled',cancel_reason='Recipient blocked: '||block,finished_at=now(),updated_at=now() where id=j.id;
    perform revenue_private.transition_message(m.id,'cancelled',jsonb_build_object('failure',jsonb_build_object('reason',block)),'email.cancelled','Send stopped: recipient is '||replace(block,'_',' '),'automation','system','email.cancelled:'||m.id,
     'Review consent and suppression for this customer.');
    continue;
   end if;
   select count(*) into sent from public.revenue_messages where workspace_id=j.workspace_id and direction='outbound' and provider_accepted_at>=date_trunc('day',now()) and approval_source<>'external';
   sent := sent + (select count(*) from public.revenue_jobs where workspace_id=j.workspace_id and kind='mail.send' and status='running');
   if sent>=coalesce(ctl.daily_send_limit,200) then
    update public.revenue_jobs set run_at=date_trunc('day',now())+interval '1 day',last_error='Daily send limit reached',updated_at=now() where id=j.id;
    insert into public.revenue_job_runs(job_id,workspace_id,attempt,worker,finished_at,outcome,error) values(j.id,j.workspace_id,j.attempts,p_worker,now(),'deferred','Daily send limit reached');
    continue;
   end if;
   update public.revenue_jobs set status='running',attempts=attempts+1,locked_by=p_worker,locked_until=now()+interval '5 minutes',updated_at=now() where id=j.id;
   insert into public.revenue_job_runs(job_id,workspace_id,attempt,worker,outcome) values(j.id,j.workspace_id,j.attempts+1,p_worker,'running');
   select * into ident from public.revenue_sender_identities where id=m.sender_identity_id;
   out := out || jsonb_build_array(jsonb_build_object('job_id',j.id,'kind',j.kind,'workspace_id',j.workspace_id,'attempt',j.attempts+1,
    'message',jsonb_build_object('id',m.id,'account_id',m.account_id,'thread_id',m.thread_id,'to',m.to_email,'cc',m.cc,'subject',m.subject,
     'body',m.body||case when coalesce(m.signature_snapshot,'')<>'' and position(m.signature_snapshot in m.body)=0 then E'\n\n'||m.signature_snapshot else '' end,
     'from_email',coalesce(ident.email,m.from_email),'from_name',ident.display_name,'reply_to',m.reply_to_snapshot,'in_reply_to',m.in_reply_to,'attachments',m.attachments,'idempotency_key','onixus-'||m.id)));
  elsif j.kind='mail.follow_up' then
   select * into src from public.revenue_messages where id=(j.payload->>'source_message_id')::uuid;
   select exists(select 1 from public.revenue_messages where workspace_id=j.workspace_id and direction='inbound' and
     ((src.thread_id is not null and thread_id=src.thread_id and account_id is not distinct from src.account_id) or customer_id=src.customer_id)
     and occurred_at>coalesce(src.provider_accepted_at,src.created_at)) into replied;
   if replied then
    update public.revenue_jobs set status='cancelled',cancel_reason='Customer replied',finished_at=now(),updated_at=now() where id=j.id;
    perform revenue_private.record_event(j.workspace_id,src.customer_id,null,'follow_up.cancelled','automation','system',null,now(),'cancelled','job',j.id,'Follow-up stopped because the customer replied','{}','{}','follow_up.cancelled:'||j.id);
    continue;
   end if;
   block := revenue_private.block_reason(j.workspace_id,src.to_email,'follow_up');
   if block is not null then
    update public.revenue_jobs set status='cancelled',cancel_reason='Recipient blocked: '||block,finished_at=now(),updated_at=now() where id=j.id;
    continue;
   end if;
   wf := revenue_private.workflow(j.workspace_id,'follow_up_no_reply');
   insert into public.revenue_messages(workspace_id,customer_id,deal_id,account_id,thread_id,direction,purpose,status,to_email,from_email,subject,body,sender_identity_id,in_reply_to,automation_key,follow_up_of,idempotency_key)
   values(j.workspace_id,src.customer_id,src.deal_id,src.account_id,src.thread_id,'outbound','follow_up','drafted',src.to_email,src.from_email,
          case when src.subject ~* '^re:' then src.subject else 'Re: '||src.subject end,j.payload->>'body',src.sender_identity_id,src.provider_message_id,'follow_up_no_reply',src.id,'follow_up_draft:'||j.id)
   on conflict(workspace_id,idempotency_key) do nothing returning id into nm;
   if nm is not null then
    perform revenue_private.record_event(j.workspace_id,src.customer_id,src.deal_id,'email.drafted','automation','automation','Follow-up workflow',now(),'drafted','message',nm,'Follow-up drafted (no reply yet)','{}',jsonb_build_object('thread_id',src.thread_id),'email.drafted:'||nm);
    if coalesce(wf.enabled,false) and coalesce(wf.auto_send_authorized,false) then
     perform revenue_private.transition_message(nm,'approved',jsonb_build_object('approval_source','automation','automation_key','follow_up_no_reply','signature',(select signature from public.revenue_sender_identities where id=src.sender_identity_id)),
      'email.approved','Approved by the authorized follow-up workflow','automation','automation','email.approved:'||nm);
     nj := revenue_private.enqueue(j.workspace_id,'mail.send','follow_up_no_reply','mail.send:'||nm,jsonb_build_object('message_id',nm),now(),src.customer_id,nm,j.chain_depth+1,j.id);
     perform revenue_private.transition_message(nm,'queued','{}','email.queued','Queued for sending','automation','system','email.queued:'||nm||':first');
    end if;
   end if;
   update public.revenue_jobs set status='succeeded',attempts=attempts+1,finished_at=now(),updated_at=now(),last_error=null where id=j.id;
   insert into public.revenue_job_runs(job_id,workspace_id,attempt,worker,finished_at,outcome,detail) values(j.id,j.workspace_id,j.attempts+1,p_worker,now(),'succeeded',jsonb_build_object('draft_id',nm,'auto_send',coalesce(wf.auto_send_authorized,false)));
   processed := processed || jsonb_build_array(jsonb_build_object('job_id',j.id,'kind',j.kind,'draft_id',nm));
  elsif j.kind in ('inquiry.acknowledge','onboarding.kickoff') then
   perform revenue_private.run_internal_job(j.id,p_worker);
   processed := processed || jsonb_build_array(jsonb_build_object('job_id',j.id,'kind',j.kind));
  end if;
 end loop;
 return jsonb_build_object('jobs',out,'processed',processed);
end $$;

create or replace function public.revenue_worker_complete(p_token text, p_job uuid, p_worker text, p_result jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.revenue_jobs; m public.revenue_messages; delay interval; code text := p_result->'error'->>'code'; msg text := left(p_result->'error'->>'message',500); final boolean;
begin
 perform revenue_private.require_worker(p_token);
 select * into j from public.revenue_jobs where id=p_job for update;
 if j.id is null or j.status<>'running' or j.locked_by is distinct from p_worker then
  return jsonb_build_object('ignored','job_not_leased_by_worker');
 end if;
 select * into m from public.revenue_messages where id=j.message_id for update;
 if coalesce((p_result->>'ok')::boolean,false) then
  update public.revenue_jobs set status='succeeded',locked_by=null,locked_until=null,last_error=null,finished_at=now(),updated_at=now() where id=j.id;
  update public.revenue_job_runs set finished_at=now(),outcome='succeeded',detail=jsonb_build_object('provider_message_id',p_result->>'provider_message_id') where job_id=j.id and outcome='running';
  perform revenue_private.transition_message(m.id,'provider_accepted',jsonb_build_object('provider_message_id',p_result->>'provider_message_id','provider_thread_id',p_result->>'provider_thread_id',
    'detail',jsonb_build_object('provider_message_id',p_result->>'provider_message_id','delivery_confirmed',false)),
   'email.provider_accepted','Accepted by '||coalesce(p_result->>'provider','the mail provider')||'. Delivery is not confirmed yet.','gmail','provider','email.accepted:'||m.id);
  if m.account_id is not null and m.customer_id is not null and coalesce(m.thread_id,p_result->>'provider_thread_id') is not null then
   insert into public.crm_mail_threads(account_id,thread_id,workspace_id,customer_id,subject,last_event_at,state,last_outbound_at)
   values(m.account_id,coalesce(m.thread_id,p_result->>'provider_thread_id'),m.workspace_id,m.customer_id,m.subject,now(),'waiting_on_customer',now())
   on conflict(workspace_id,account_id,thread_id) do update set last_outbound_at=now(),last_event_at=now(),
    state=case when public.crm_mail_threads.last_inbound_at>now() then public.crm_mail_threads.state else 'waiting_on_customer' end,
    reply_lock_by=null,reply_lock_until=null;
   update public.crm_tasks set status='done',completed_at=now() where workspace_id=m.workspace_id and action_key=md5('reply:'||m.account_id||':'||coalesce(m.thread_id,p_result->>'provider_thread_id'))::uuid and status='open';
  end if;
  return jsonb_build_object('job_id',j.id,'status','succeeded','message_status','provider_accepted');
 end if;
 final := not coalesce((p_result->>'retryable')::boolean,false) or j.attempts>=j.max_attempts;
 if final then
  update public.revenue_jobs set status='dead',locked_by=null,locked_until=null,last_error=coalesce(msg,code,'Send failed'),finished_at=now(),updated_at=now() where id=j.id;
  update public.revenue_job_runs set finished_at=now(),outcome='dead',error=coalesce(msg,code) where job_id=j.id and outcome='running';
  perform revenue_private.transition_message(m.id,'failed',jsonb_build_object('failure',jsonb_build_object('reason',coalesce(code,'send_failed'),'detail',msg,'attempts',j.attempts)),
   'email.failed','Send failed: '||coalesce(msg,code,'unknown error'),'gmail','provider','email.failed:'||m.id||':'||j.attempts||':'||now()::text,
   case when code='auth_expired' then 'Reconnect Google in Onixus Mail, then retry this message.' else 'Check the error, fix the cause, then retry this message.' end);
  if code='auth_expired' and m.account_id is not null then
   insert into public.revenue_sync_state(workspace_id,account_id,status,last_attempt_at,last_error) values(m.workspace_id,m.account_id,'expired',now(),msg)
   on conflict(workspace_id,account_id) do update set status='expired',last_attempt_at=now(),last_error=excluded.last_error;
  end if;
  return jsonb_build_object('job_id',j.id,'status','dead','message_status','failed');
 end if;
 delay := least(make_interval(secs=>30*power(2,j.attempts-1)), interval '1 hour');
 update public.revenue_jobs set status='queued',locked_by=null,locked_until=null,run_at=now()+delay,last_error=coalesce(msg,code),updated_at=now() where id=j.id;
 update public.revenue_job_runs set finished_at=now(),outcome='retry',error=coalesce(msg,code) where job_id=j.id and outcome='running';
 update public.revenue_messages set failure=jsonb_build_object('reason',coalesce(code,'temporary'),'detail',msg,'retrying_at',now()+delay),updated_at=now() where id=m.id;
 return jsonb_build_object('job_id',j.id,'status','queued','retry_in_seconds',extract(epoch from delay));
end $$;

-- RLS: members read; writes through functions only.
do $$ declare t text; begin
 foreach t in array array['revenue_sender_identities','revenue_templates','revenue_messages','revenue_thread_comments','revenue_sync_state','revenue_workflows','revenue_controls','revenue_jobs','revenue_job_runs'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('grant all on public.%I to service_role',t);
  execute format('drop policy if exists revenue_member_read on public.%I',t);
  execute format('create policy revenue_member_read on public.%I for select to authenticated using (workspace_id in (select workspace_id from public.crm_memberships where user_id=(select auth.uid())))',t);
 end loop;
end $$;
-- Integration rows (token hashes) are visible to owners only.
alter table public.revenue_integrations enable row level security;
revoke all on public.revenue_integrations from public,anon,authenticated;
grant select(id,workspace_id,provider,label,status,created_by,created_at,last_success_at,last_error,last_error_at) on public.revenue_integrations to authenticated;
drop policy if exists revenue_owner_read on public.revenue_integrations;
create policy revenue_owner_read on public.revenue_integrations for select to authenticated using (revenue_private.is_owner(workspace_id));

do $$ declare f text; begin
 foreach f in array array['revenue_draft_message(uuid,jsonb)','revenue_update_draft(uuid,uuid,text,text)','revenue_approve_message(uuid,uuid)','revenue_cancel_message(uuid,uuid,text)',
  'revenue_retry_message(uuid,uuid)','revenue_thread_action(uuid,uuid,text,text,jsonb)','revenue_schedule_follow_up(uuid,uuid,timestamptz,text)',
  'revenue_save_template(uuid,uuid,text,text,text,boolean)','revenue_save_sender_identity(uuid,text,text,text,text,boolean,uuid)','revenue_suppress(uuid,text,text,text)',
  'revenue_unsuppress(uuid,text,text)','revenue_set_controls(uuid,boolean,text,integer,bigint)','revenue_set_workflow(uuid,text,boolean,boolean,jsonb)',
  'revenue_job_action(uuid,uuid,text,text)','revenue_create_integration(uuid,text,text,text)','revenue_revoke_integration(uuid,uuid)'] loop
  execute 'revoke all on function public.'||f||' from public, anon';
  execute 'grant execute on function public.'||f||' to authenticated';
 end loop;
 foreach f in array array['revenue_ingest_mail_event(uuid,text,jsonb)','revenue_worker_claim(text,text,integer,boolean)','revenue_worker_complete(text,uuid,text,jsonb)'] loop
  execute 'revoke all on function public.'||f||' from public';
  execute 'grant execute on function public.'||f||' to anon, authenticated';
 end loop;
 foreach f in array array['revenue_private.require_worker(text)','revenue_private.integration(uuid,text,text)','revenue_private.block_reason(uuid,text,text)',
  'revenue_private.transition_message(uuid,text,jsonb,text,text,text,text,text,text)','revenue_private.enqueue(uuid,text,text,text,jsonb,timestamptz,uuid,uuid,integer,uuid,integer)',
  'revenue_private.workflow(uuid,text)','revenue_private.queue_send(uuid,integer,uuid)','revenue_private.cancel_for_recipient(uuid,text,text)'] loop
  execute 'revoke all on function '||f||' from public, anon, authenticated';
 end loop;
end $$;
commit;
