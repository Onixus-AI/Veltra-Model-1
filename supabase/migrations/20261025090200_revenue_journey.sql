-- Onixus revenue system, Phase 1, part 3: form and calendar ingestion, meetings, proposals,
-- verified payments, onboarding (exactly once), service engagements, internal workflow jobs,
-- shared customer context (Chat + Mail) and the company overview.
--
-- Business rules for payments (explicit):
--  * Only signed provider webhooks change payment state. Browser redirects never do.
--  * Each provider event id is processed once (ledger). Amounts received/refunded only grow, so
--    out-of-order delivery converges to the same state. A failure that arrives after a success
--    never downgrades the payment.
--  * Proposal paid = sum(received - refunded) across its payments. "paid" when >= amount,
--    "partially_paid" when > 0, "refunded" when fully refunded, "payment_failed" when the latest
--    attempt failed and nothing was collected.
--  * Onboarding starts once, when the proposal rule is met (paid in full, or deposit percent).
--    A later refund below the rule puts onboarding on hold and creates a review task; it is never
--    deleted or restarted as a second onboarding.
begin;

create table if not exists public.revenue_meetings(
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.crm_workspaces(id),
 customer_id uuid not null,
 deal_id uuid references public.crm_deals(id),
 title text not null check(length(trim(title)) between 1 and 300),
 starts_at timestamptz not null,
 ends_at timestamptz not null,
 status text not null default 'scheduled' check(status in ('scheduled','cancelled','completed','no_show')),
 provider text not null default 'manual' check(provider in ('manual','google_calendar','microsoft_calendar','booking_form')),
 provider_event_id text not null,
 provider_updated_at timestamptz,
 created_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 unique(workspace_id,provider,provider_event_id),
 check(ends_at>starts_at),
 foreign key(workspace_id,customer_id) references public.crm_customers(workspace_id,id)
);

create table if not exists public.revenue_proposals(
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.crm_workspaces(id),
 customer_id uuid not null,
 deal_id uuid references public.crm_deals(id),
 title text not null check(length(trim(title)) between 1 and 300),
 line_items jsonb not null default '[]',
 amount_cents bigint not null check(amount_cents between 50 and 10000000000),
 currency text not null default 'USD' check(currency ~ '^[A-Z]{3}$'),
 status text not null default 'draft' check(status in ('draft','sent','partially_paid','paid','payment_failed','refunded','cancelled')),
 onboarding_rule text not null default 'paid_in_full' check(onboarding_rule in ('paid_in_full','deposit')),
 deposit_percent integer check(deposit_percent between 1 and 100),
 amount_paid_cents bigint not null default 0,
 amount_refunded_cents bigint not null default 0,
 checkout_reference text,
 checkout_url text,
 sent_at timestamptz,
 created_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(onboarding_rule<>'deposit' or deposit_percent is not null),
 foreign key(workspace_id,customer_id) references public.crm_customers(workspace_id,id)
);
create index if not exists revenue_proposals_ws on public.revenue_proposals(workspace_id,status,created_at desc);

create table if not exists public.revenue_payments(
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.crm_workspaces(id),
 proposal_id uuid not null references public.revenue_proposals(id),
 customer_id uuid not null,
 provider text not null default 'stripe',
 provider_object_id text not null,
 amount_cents bigint not null default 0,
 amount_received_cents bigint not null default 0,
 amount_refunded_cents bigint not null default 0,
 currency text not null,
 status text not null default 'pending' check(status in ('pending','succeeded','failed','cancelled','partially_refunded','refunded')),
 livemode boolean not null default false,
 last_event_at timestamptz,
 failure jsonb,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(provider,provider_object_id),
 foreign key(workspace_id,customer_id) references public.crm_customers(workspace_id,id)
);
create index if not exists revenue_payments_ws on public.revenue_payments(workspace_id,updated_at desc);

create table if not exists public.revenue_provider_events(
 provider text not null,
 event_id text not null,
 workspace_id uuid,
 event_type text not null,
 event_created_at timestamptz,
 received_at timestamptz not null default now(),
 outcome text not null,
 detail jsonb not null default '{}',
 primary key(provider,event_id)
);

create table if not exists public.revenue_onboardings(
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.crm_workspaces(id),
 customer_id uuid not null,
 proposal_id uuid not null unique references public.revenue_proposals(id),
 status text not null default 'active' check(status in ('active','on_hold','completed','cancelled')),
 started_at timestamptz not null default now(),
 trigger_event text not null,
 hold_reason text,
 completed_at timestamptz,
 foreign key(workspace_id,customer_id) references public.crm_customers(workspace_id,id)
);

create table if not exists public.revenue_engagements(
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.crm_workspaces(id),
 customer_id uuid not null,
 proposal_id uuid references public.revenue_proposals(id),
 onboarding_id uuid unique references public.revenue_onboardings(id),
 name text not null,
 status text not null default 'active' check(status in ('active','paused','ended')),
 starts_at timestamptz not null default now(),
 renews_at timestamptz,
 foreign key(workspace_id,customer_id) references public.crm_customers(workspace_id,id)
);

-- ---------- forms ----------
create or replace function public.revenue_ingest_form(p_integration uuid, p_token text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.revenue_integrations := revenue_private.integration(p_integration,p_token,'form'); w uuid := i.workspace_id; r jsonb; c uuid; q uuid; d uuid; e jsonb;
 sid text := nullif(trim(p_payload->>'submission_id'),''); subj text := left(coalesce(nullif(trim(p_payload->>'subject'),''),'Website inquiry'),200);
 msg text := left(coalesce(nullif(trim(p_payload->>'message'),''),'(no message)'),4000); first_stage text; wf public.revenue_workflows; j uuid;
begin
 if sid is null or length(sid)>200 then raise exception '400:Submission id is required.'; end if;
 if i.created_by is null then raise exception '409:Recreate this form integration from a workspace owner account.'; end if;
 if exists(select 1 from public.revenue_events where workspace_id=w and dedupe_key='form:'||i.id||':'||sid) then
  select jsonb_build_object('duplicate',true,'customer_id',customer_id,'event_id',id) into e from public.revenue_events where workspace_id=w and dedupe_key='form:'||i.id||':'||sid;
  return e;
 end if;
 r := revenue_private.resolve_identity(w,p_payload->>'email',p_payload->>'phone',p_payload->>'name',p_payload->>'company','Website form',
  jsonb_build_object('integration',i.label,'source_url',left(p_payload->>'source_url',500),'utm',p_payload->'utm'));
 c := (r->>'customer_id')::uuid;
 insert into public.crm_inquiries(workspace_id,customer_id,subject,message,source,created_by,received_at)
 values(w,c,subj,msg,'website',i.created_by,coalesce((p_payload->>'submitted_at')::timestamptz,now())) returning id into q;
 select id into d from public.crm_deals where workspace_id=w and customer_id=c and revenue_private.stage_outcome(w,stage)='open' order by created_at desc limit 1;
 if d is null then
  first_stage := coalesce((select key from public.revenue_pipeline_stages where workspace_id=w and not archived and outcome='open' order by position limit 1),'new');
  insert into public.crm_deals(workspace_id,customer_id,title,stage,source) values(w,c,left('Inquiry: '||subj,300),first_stage,'Website form') returning id into d;
  perform revenue_private.record_event(w,c,d,'opportunity.created','form','system','Website form',now(),'recorded','deal',d,'Opportunity opened from a website inquiry','{}','{}','opportunity.created:'||d);
 end if;
 e := revenue_private.record_event(w,c,d,'form.submitted','form','customer',coalesce(nullif(p_payload->>'name',''),p_payload->>'email'),coalesce((p_payload->>'submitted_at')::timestamptz,now()),'received','inquiry',q,
  'Inquiry: '||subj,jsonb_build_object('identity',r,'untrusted_content',true,'source_url',left(p_payload->>'source_url',500),'utm',p_payload->'utm'),
  jsonb_build_object('inquiry_id',q,'deal_id',d),'form:'||i.id||':'||sid);
 insert into public.crm_tasks(workspace_id,customer_id,title,due_at,kind,deal_id,action_key)
 values(w,c,left('Reply to inquiry: '||subj,300),now()+interval '1 day','follow_up',d,md5('inquiry:'||i.id||':'||sid)::uuid) on conflict do nothing;
 wf := revenue_private.workflow(w,'inquiry_acknowledgement');
 if coalesce(wf.enabled,false) then
  j := revenue_private.enqueue(w,'inquiry.acknowledge','inquiry_acknowledgement','inquiry.ack:'||q,
   jsonb_build_object('inquiry_id',q,'customer_id',c,'deal_id',d,'to',p_payload->>'email','subject',subj),now(),c,null,0,null);
 end if;
 update public.revenue_integrations set last_success_at=now() where id=i.id;
 return jsonb_build_object('duplicate',false,'customer_id',c,'identity',r,'inquiry_id',q,'deal_id',d,'event_id',e->>'event_id','job_id',j);
end $$;

-- ---------- meetings ----------
create or replace function revenue_private.upsert_meeting(p_workspace uuid, p_customer uuid, p_deal uuid, p_title text, p_starts timestamptz, p_ends timestamptz, p_status text, p_provider text, p_event_id text, p_updated timestamptz, p_actor text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.revenue_meetings; d uuid := p_deal; prev text;
begin
 if d is null then
  select id into d from public.crm_deals where workspace_id=p_workspace and customer_id=p_customer and revenue_private.stage_outcome(p_workspace,stage)='open' order by created_at desc limit 1;
 end if;
 select * into m from public.revenue_meetings where workspace_id=p_workspace and provider=p_provider and provider_event_id=p_event_id for update;
 if m.id is not null and p_updated is not null and m.provider_updated_at is not null and p_updated<=m.provider_updated_at then
  return jsonb_build_object('meeting_id',m.id,'ignored','stale_update');
 end if;
 prev := m.status;
 insert into public.revenue_meetings(workspace_id,customer_id,deal_id,title,starts_at,ends_at,status,provider,provider_event_id,provider_updated_at,created_by)
 values(p_workspace,p_customer,d,left(p_title,300),p_starts,p_ends,coalesce(p_status,'scheduled'),p_provider,p_event_id,p_updated,auth.uid())
 on conflict(workspace_id,provider,provider_event_id) do update set title=excluded.title,starts_at=excluded.starts_at,ends_at=excluded.ends_at,status=excluded.status,provider_updated_at=excluded.provider_updated_at,deal_id=coalesce(public.revenue_meetings.deal_id,excluded.deal_id)
 returning * into m;
 if prev is distinct from m.status then
  perform revenue_private.record_event(p_workspace,p_customer,m.deal_id,'meeting.'||m.status,case when p_provider='manual' then 'crm' else 'calendar' end,p_actor,null,now(),m.status,'meeting',m.id,
   case m.status when 'scheduled' then 'Meeting booked: ' when 'cancelled' then 'Meeting cancelled: ' else 'Meeting '||m.status||': ' end||m.title||' ('||to_char(m.starts_at at time zone 'UTC','YYYY-MM-DD HH24:MI')||' UTC)',
   jsonb_build_object('starts_at',m.starts_at,'ends_at',m.ends_at),jsonb_build_object('deal_id',m.deal_id),'meeting.'||m.status||':'||m.id);
 end if;
 return jsonb_build_object('meeting_id',m.id,'deal_id',m.deal_id,'status',m.status);
end $$;

create or replace function public.revenue_book_meeting(p_workspace uuid, p_customer uuid, p_deal uuid, p_title text, p_starts timestamptz, p_ends timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid := revenue_private.require_role(p_workspace,'member'); r jsonb;
begin
 if not exists(select 1 from public.crm_customers where workspace_id=p_workspace and id=p_customer and merged_into_id is null) then raise exception '404:Customer not found.'; end if;
 if p_deal is not null and not exists(select 1 from public.crm_deals where workspace_id=p_workspace and id=p_deal and customer_id=p_customer) then raise exception '400:Choose an opportunity for this customer.'; end if;
 r := revenue_private.upsert_meeting(p_workspace,p_customer,p_deal,p_title,p_starts,p_ends,'scheduled','manual',gen_random_uuid()::text,now(),'user');
 perform revenue_private.audit(p_workspace,'user','meeting.book','meeting',r->>'meeting_id','{}');
 return r;
end $$;

create or replace function public.revenue_ingest_calendar_event(p_integration uuid, p_token text, p_event jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.revenue_integrations := revenue_private.integration(p_integration,p_token,'calendar'); r jsonb;
begin
 if nullif(p_event->>'provider_event_id','') is null then raise exception '400:Calendar event id required.'; end if;
 r := revenue_private.resolve_identity(i.workspace_id,p_event->>'attendee_email',null,p_event->>'attendee_name',null,'Calendar',jsonb_build_object('integration',i.label));
 update public.revenue_integrations set last_success_at=now() where id=i.id;
 return revenue_private.upsert_meeting(i.workspace_id,(r->>'customer_id')::uuid,null,coalesce(p_event->>'title','Meeting'),(p_event->>'starts_at')::timestamptz,(p_event->>'ends_at')::timestamptz,
  case when p_event->>'status'='cancelled' then 'cancelled' else 'scheduled' end,coalesce(p_event->>'provider','google_calendar'),p_event->>'provider_event_id',(p_event->>'updated_at')::timestamptz,'provider')||jsonb_build_object('identity',r);
end $$;

-- ---------- proposals ----------
create or replace function public.revenue_create_proposal(p_workspace uuid, p_customer uuid, p_deal uuid, p_title text, p_amount_cents bigint, p_currency text,
 p_rule text default 'paid_in_full', p_deposit_percent integer default null, p_line_items jsonb default '[]')
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid := revenue_private.require_role(p_workspace,'member'); p uuid;
begin
 if not exists(select 1 from public.crm_customers where workspace_id=p_workspace and id=p_customer and merged_into_id is null) then raise exception '404:Customer not found.'; end if;
 if p_deal is not null and not exists(select 1 from public.crm_deals where workspace_id=p_workspace and id=p_deal and customer_id=p_customer) then raise exception '400:Choose an opportunity for this customer.'; end if;
 insert into public.revenue_proposals(workspace_id,customer_id,deal_id,title,amount_cents,currency,onboarding_rule,deposit_percent,line_items,created_by)
 values(p_workspace,p_customer,p_deal,p_title,p_amount_cents,upper(coalesce(p_currency,'USD')),coalesce(p_rule,'paid_in_full'),p_deposit_percent,coalesce(p_line_items,'[]'),u) returning id into p;
 perform revenue_private.record_event(p_workspace,p_customer,p_deal,'proposal.drafted','crm','user',null,now(),'draft','proposal',p,'Proposal prepared: '||p_title,
  jsonb_build_object('amount_cents',p_amount_cents,'currency',upper(coalesce(p_currency,'USD'))),'{}','proposal.drafted:'||p);
 perform revenue_private.audit(p_workspace,'user','proposal.create','proposal',p::text,'{}');
 return jsonb_build_object('proposal_id',p,'status','draft');
end $$;

create or replace function public.revenue_mark_proposal_sent(p_workspace uuid, p_proposal uuid, p_checkout_reference text, p_checkout_url text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid := revenue_private.require_role(p_workspace,'member'); p public.revenue_proposals;
begin
 update public.revenue_proposals set status='sent',sent_at=now(),checkout_reference=coalesce(p_checkout_reference,checkout_reference),checkout_url=coalesce(p_checkout_url,checkout_url),updated_at=now()
  where workspace_id=p_workspace and id=p_proposal and status in ('draft','sent','payment_failed') returning * into p;
 if p.id is null then raise exception '409:Only draft or unpaid proposals can be sent.'; end if;
 perform revenue_private.record_event(p_workspace,p.customer_id,p.deal_id,'proposal.sent','crm','user',null,now(),'sent','proposal',p.id,'Proposal sent: '||p.title,
  jsonb_build_object('payment_link',p_checkout_url is not null),'{}','proposal.sent:'||p.id||':'||coalesce(p_checkout_reference,'manual'));
 return jsonb_build_object('proposal_id',p.id,'status','sent');
end $$;

create or replace function public.revenue_cancel_proposal(p_workspace uuid, p_proposal uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid := revenue_private.require_role(p_workspace,'member'); p public.revenue_proposals;
begin
 update public.revenue_proposals set status='cancelled',updated_at=now() where workspace_id=p_workspace and id=p_proposal and amount_paid_cents=0 and status<>'cancelled' returning * into p;
 if p.id is null then raise exception '409:Proposals with collected payments must be refunded before cancelling.'; end if;
 perform revenue_private.record_event(p_workspace,p.customer_id,p.deal_id,'proposal.cancelled','crm','user',null,now(),'cancelled','proposal',p.id,'Proposal cancelled',jsonb_build_object('reason',left(p_reason,300)),'{}','proposal.cancelled:'||p.id);
 return jsonb_build_object('proposal_id',p.id,'status','cancelled');
end $$;

-- ---------- payments (signed provider events only) ----------
create or replace function public.revenue_ingest_payment_event(p_integration uuid, p_token text, p_event jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.revenue_integrations := revenue_private.integration(p_integration,p_token,'stripe'); w uuid := i.workspace_id;
 eid text := p_event->>'event_id'; ety text := p_event->>'type'; created timestamptz := coalesce((p_event->>'created')::timestamptz,now());
 p public.revenue_proposals; pay public.revenue_payments; inserted text; oid text := p_event->>'object_id';
 rec bigint := coalesce((p_event->>'amount_received_cents')::bigint,0); ref bigint := coalesce((p_event->>'amount_refunded_cents')::bigint,0);
 net bigint; refunded bigint; threshold bigint; new_status text; ob public.revenue_onboardings; ob_new uuid; won text; d public.crm_deals; kind text; summary text; last_failed boolean;
begin
 if eid is null or ety is null then raise exception '400:Event id and type are required.'; end if;
 if (p_event->>'workspace_id') is distinct from w::text then
  insert into public.revenue_provider_events(provider,event_id,workspace_id,event_type,event_created_at,outcome,detail) values('stripe',eid,w,ety,created,'rejected_workspace_mismatch',jsonb_build_object('claimed',p_event->>'workspace_id')) on conflict do nothing;
  raise exception '403:Payment event belongs to a different workspace.' using errcode='42501';
 end if;
 insert into public.revenue_provider_events(provider,event_id,workspace_id,event_type,event_created_at,outcome) values('stripe',eid,w,ety,created,'processing')
 on conflict(provider,event_id) do nothing returning event_id into inserted;
 if inserted is null then return jsonb_build_object('duplicate',true,'event_id',eid); end if;
 select * into p from public.revenue_proposals where workspace_id=w and id=nullif(p_event->>'proposal_id','')::uuid for update;
 if p.id is null then
  update public.revenue_provider_events set outcome='unmatched',detail=jsonb_build_object('proposal_id',p_event->>'proposal_id') where provider='stripe' and event_id=eid;
  perform revenue_private.record_event(w,null,null,'payment.unmatched','stripe','provider',null,created,'failed',null,null,'Payment event did not match a proposal in this workspace',
   jsonb_build_object('event_id',eid,'type',ety),'{}','stripe:'||eid,jsonb_build_object('reason','unmatched_proposal'),'Check the proposal id in the Stripe metadata.');
  return jsonb_build_object('duplicate',false,'outcome','unmatched');
 end if;
 if oid is null then raise exception '400:Payment object id is required.'; end if;
 insert into public.revenue_payments(workspace_id,proposal_id,customer_id,provider,provider_object_id,amount_cents,currency,livemode)
 values(w,p.id,p.customer_id,'stripe',oid,coalesce((p_event->>'amount_cents')::bigint,0),upper(coalesce(p_event->>'currency',p.currency)),coalesce((p_event->>'livemode')::boolean,false))
 on conflict(provider,provider_object_id) do nothing;
 select * into pay from public.revenue_payments where provider='stripe' and provider_object_id=oid for update;
 if pay.workspace_id<>w or pay.proposal_id<>p.id then raise exception '409:Payment object is linked to another proposal.'; end if;
 if upper(coalesce(p_event->>'currency',p.currency))<>p.currency then raise exception '409:Payment currency does not match the proposal.'; end if;
 rec := greatest(pay.amount_received_cents,rec); ref := greatest(pay.amount_refunded_cents,least(ref,rec));
 new_status := case
  when rec>0 and ref>=rec then 'refunded'
  when rec>0 and ref>0 then 'partially_refunded'
  when rec>0 then 'succeeded'
  when ety in ('payment_intent.payment_failed','checkout.session.async_payment_failed') then 'failed'
  when ety in ('payment_intent.canceled','checkout.session.expired') then 'cancelled'
  else pay.status end;
 update public.revenue_payments set amount_received_cents=rec,amount_refunded_cents=ref,status=new_status,amount_cents=greatest(amount_cents,coalesce((p_event->>'amount_cents')::bigint,0)),
  last_event_at=greatest(coalesce(last_event_at,created),created),
  failure=case when new_status='failed' then jsonb_build_object('code',p_event->>'failure_code','message',left(p_event->>'failure_message',300)) else failure end,updated_at=now()
 where id=pay.id;
 select coalesce(sum(amount_received_cents-amount_refunded_cents),0),coalesce(sum(amount_refunded_cents),0) into net,refunded from public.revenue_payments where proposal_id=p.id;
 select status='failed' into last_failed from public.revenue_payments where proposal_id=p.id order by coalesce(last_event_at,created_at) desc limit 1;
 update public.revenue_proposals set amount_paid_cents=net,amount_refunded_cents=refunded,updated_at=now(),
  status=case when status='cancelled' then 'cancelled' when net>=amount_cents then 'paid' when net>0 then 'partially_paid' when refunded>0 then 'refunded' when last_failed then 'payment_failed' else status end
 where id=p.id returning * into p;
 kind := case new_status when 'succeeded' then 'payment.succeeded' when 'failed' then 'payment.failed' when 'cancelled' then 'payment.cancelled' when 'refunded' then 'payment.refunded' when 'partially_refunded' then 'payment.refunded' else 'payment.updated' end;
 summary := case kind
  when 'payment.succeeded' then 'Payment received: '||to_char(rec/100.0,'FM999999990.00')||' '||p.currency||case when p.status='partially_paid' then ' (partial)' else '' end
  when 'payment.failed' then 'Payment failed: '||coalesce(p_event->>'failure_message','declined')
  when 'payment.refunded' then 'Refund recorded: '||to_char(ref/100.0,'FM999999990.00')||' '||p.currency
  when 'payment.cancelled' then 'Payment cancelled'
  else 'Payment updated' end;
 perform revenue_private.record_event(w,p.customer_id,p.deal_id,kind,'stripe','provider','Stripe',created,new_status,'payment',pay.id,summary,
  jsonb_build_object('event_id',eid,'type',ety,'proposal_status',p.status,'net_paid_cents',net,'livemode',coalesce((p_event->>'livemode')::boolean,false)),
  jsonb_build_object('proposal_id',p.id),'stripe:'||eid,
  case when new_status='failed' then jsonb_build_object('code',p_event->>'failure_code','message',left(p_event->>'failure_message',300)) end,
  case when new_status='failed' then 'Send the customer a new payment link or contact them about the payment method.' end);
 threshold := case when p.onboarding_rule='deposit' then ceil(p.amount_cents*p.deposit_percent/100.0)::bigint else p.amount_cents end;
 select * into ob from public.revenue_onboardings where proposal_id=p.id for update;
 if net>=threshold and p.status<>'cancelled' then
  if ob.id is null then
   insert into public.revenue_onboardings(workspace_id,customer_id,proposal_id,trigger_event) values(w,p.customer_id,p.id,'stripe:'||eid)
   on conflict(proposal_id) do nothing returning id into ob_new;
   if ob_new is not null then
    insert into public.revenue_engagements(workspace_id,customer_id,proposal_id,onboarding_id,name) values(w,p.customer_id,p.id,ob_new,p.title);
    perform revenue_private.record_event(w,p.customer_id,p.deal_id,'onboarding.started','onboarding','system',null,now(),'active','onboarding',ob_new,
     'Onboarding started after verified payment',jsonb_build_object('rule',p.onboarding_rule,'net_paid_cents',net),jsonb_build_object('proposal_id',p.id),'onboarding.started:'||p.id);
    perform revenue_private.enqueue(w,'onboarding.kickoff','payment_onboarding','onboarding.kickoff:'||ob_new,jsonb_build_object('onboarding_id',ob_new,'proposal_id',p.id),now(),p.customer_id,null,0,null);
    if p.deal_id is not null then
     select * into d from public.crm_deals where id=p.deal_id;
     won := coalesce((select key from public.revenue_pipeline_stages where workspace_id=w and outcome='won' and not archived order by position limit 1),
                     case when not exists(select 1 from public.revenue_pipeline_stages where workspace_id=w and not archived) then 'won' end);
     if won is not null and revenue_private.stage_outcome(w,d.stage)='open' then
      update public.crm_deals set stage=won where id=d.id;
      perform revenue_private.record_event(w,p.customer_id,d.id,'opportunity.stage_changed','stripe','system','Verified payment',now(),'recorded','deal',d.id,
       'Stage moved from '||d.stage||' to '||won||' (verified payment)',jsonb_build_object('from',d.stage,'to',won,'evidence','stripe:'||eid),'{}','opportunity.won:'||d.id);
     end if;
    end if;
   end if;
  elsif ob.status='on_hold' then
   update public.revenue_onboardings set status='active',hold_reason=null where id=ob.id;
   perform revenue_private.record_event(w,p.customer_id,p.deal_id,'onboarding.resumed','onboarding','system',null,now(),'active','onboarding',ob.id,'Onboarding resumed: payment condition met again','{}','{}','onboarding.resumed:'||ob.id||':'||eid);
  end if;
 elsif ob.id is not null and ob.status='active' and net<threshold then
  update public.revenue_onboardings set status='on_hold',hold_reason='Payment fell below the onboarding condition ('||kind||')' where id=ob.id;
  insert into public.crm_tasks(workspace_id,customer_id,title,due_at,kind,action_key) values(w,p.customer_id,'Review refund/cancellation before continuing onboarding',now()+interval '1 day','review',md5('onboarding-hold:'||ob.id||':'||eid)::uuid) on conflict do nothing;
  perform revenue_private.record_event(w,p.customer_id,p.deal_id,'onboarding.on_hold','onboarding','system',null,now(),'on_hold','onboarding',ob.id,'Onboarding on hold after refund or cancellation','{}','{}','onboarding.hold:'||ob.id||':'||eid,
   jsonb_build_object('reason','payment_below_condition'),'Review the refund with the customer and decide whether to continue or cancel the engagement.');
 end if;
 update public.revenue_provider_events set outcome='processed',detail=jsonb_build_object('payment_status',new_status,'proposal_status',p.status) where provider='stripe' and event_id=eid;
 update public.revenue_integrations set last_success_at=now() where id=i.id;
 return jsonb_build_object('duplicate',false,'payment_status',new_status,'proposal_status',p.status,'onboarding_started',ob_new is not null,'net_paid_cents',net);
end $$;

-- Browser return pages read status only; they never change it.
create or replace function public.revenue_proposal_status(p_workspace uuid, p_proposal uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p public.revenue_proposals;
begin
 perform revenue_private.require_role(p_workspace,'viewer');
 select * into p from public.revenue_proposals where workspace_id=p_workspace and id=p_proposal;
 if p.id is null then raise exception '404:Proposal not found.'; end if;
 return jsonb_build_object('proposal_id',p.id,'status',p.status,'amount_cents',p.amount_cents,'amount_paid_cents',p.amount_paid_cents,'currency',p.currency,
  'confirmed_by_provider',p.status in ('paid','partially_paid','refunded'),
  'onboarding',(select jsonb_build_object('id',id,'status',status,'started_at',started_at) from public.revenue_onboardings where proposal_id=p.id));
end $$;

-- ---------- internal workflow jobs ----------
create or replace function revenue_private.run_internal_job(p_job uuid, p_worker text) returns void language plpgsql security definer set search_path='' as $$
declare j public.revenue_jobs; wf public.revenue_workflows; m uuid; ob public.revenue_onboardings; p public.revenue_proposals; c public.crm_customers; item text; block text; ident uuid; body text;
begin
 select * into j from public.revenue_jobs where id=p_job for update;
 if j.kind='inquiry.acknowledge' then
  wf := revenue_private.workflow(j.workspace_id,'inquiry_acknowledgement');
  select * into c from public.crm_customers where workspace_id=j.workspace_id and id=(j.payload->>'customer_id')::uuid;
  select id into ident from public.revenue_sender_identities where workspace_id=j.workspace_id order by is_shared desc, created_at limit 1;
  body := coalesce(wf.settings->>'body','Hi '||coalesce(nullif(split_part(c.name,' ',1),''),'there')||E',\n\nThank you for contacting us about "'||(j.payload->>'subject')||E'". We have received your message and a member of our team will reply within one business day.');
  insert into public.revenue_messages(workspace_id,customer_id,deal_id,direction,purpose,status,to_email,subject,body,sender_identity_id,automation_key,idempotency_key)
  values(j.workspace_id,c.id,(j.payload->>'deal_id')::uuid,'outbound','transactional','drafted',lower(j.payload->>'to'),'Re: '||(j.payload->>'subject'),body,ident,'inquiry_acknowledgement','inquiry_ack:'||(j.payload->>'inquiry_id'))
  on conflict(workspace_id,idempotency_key) do nothing returning id into m;
  if m is not null then
   perform revenue_private.record_event(j.workspace_id,c.id,(j.payload->>'deal_id')::uuid,'email.drafted','automation','automation','Inquiry acknowledgement',now(),'drafted','message',m,'Acknowledgement drafted for review','{}','{}','email.drafted:'||m);
   block := revenue_private.block_reason(j.workspace_id,j.payload->>'to','transactional');
   if coalesce(wf.auto_send_authorized,false) and block is null then
    perform revenue_private.transition_message(m,'approved',jsonb_build_object('approval_source','automation','automation_key','inquiry_acknowledgement','signature',(select signature from public.revenue_sender_identities where id=ident),'reply_to',(select reply_to from public.revenue_sender_identities where id=ident)),
     'email.approved','Approved by the authorized acknowledgement workflow','automation','automation','email.approved:'||m);
    perform revenue_private.queue_send(m,j.chain_depth+1,j.id);
   end if;
  end if;
 elsif j.kind='onboarding.kickoff' then
  select * into ob from public.revenue_onboardings where id=(j.payload->>'onboarding_id')::uuid;
  select * into p from public.revenue_proposals where id=ob.proposal_id;
  select * into c from public.crm_customers where workspace_id=j.workspace_id and id=ob.customer_id;
  wf := revenue_private.workflow(j.workspace_id,'payment_onboarding');
  for item in select jsonb_array_elements_text(coalesce(wf.settings->'checklist','["Schedule the kickoff call","Collect onboarding information","Confirm the service start date"]'::jsonb)) loop
   insert into public.crm_tasks(workspace_id,customer_id,title,due_at,kind,deal_id,action_key) values(j.workspace_id,ob.customer_id,left(item,300),now()+interval '2 days','onboarding',p.deal_id,md5('onboarding:'||ob.id||':'||item)::uuid) on conflict do nothing;
  end loop;
  if c.email is not null then
   select id into ident from public.revenue_sender_identities where workspace_id=j.workspace_id order by is_shared desc, created_at limit 1;
   insert into public.revenue_messages(workspace_id,customer_id,deal_id,direction,purpose,status,to_email,subject,body,sender_identity_id,automation_key,idempotency_key)
   values(j.workspace_id,c.id,p.deal_id,'outbound','onboarding','drafted',c.email,'Welcome — next steps for '||p.title,
          coalesce(wf.settings->>'body','Hi '||coalesce(nullif(split_part(c.name,' ',1),''),'there')||E',\n\nThank you — your payment is confirmed. Next, we will schedule a kickoff call and collect what we need to start.'),
          ident,'payment_onboarding','onboarding_welcome:'||ob.id)
   on conflict(workspace_id,idempotency_key) do nothing returning id into m;
   if m is not null then
    perform revenue_private.record_event(j.workspace_id,c.id,p.deal_id,'email.drafted','automation','automation','Onboarding workflow',now(),'drafted','message',m,'Welcome email drafted for review','{}','{}','email.drafted:'||m);
   end if;
  end if;
 end if;
 update public.revenue_jobs set status='succeeded',attempts=attempts+1,finished_at=now(),updated_at=now(),last_error=null where id=p_job;
 insert into public.revenue_job_runs(job_id,workspace_id,attempt,worker,finished_at,outcome,detail) values(p_job,j.workspace_id,j.attempts+1,p_worker,now(),'succeeded',jsonb_build_object('message_id',m));
end $$;

-- ---------- shared customer context (Chat, Mail, CRM use the same function) ----------
create or replace function public.revenue_customer_context(p_workspace uuid, p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c public.crm_customers; owner boolean;
begin
 perform revenue_private.require_role(p_workspace,'viewer');
 owner := revenue_private.is_owner(p_workspace);
 select * into c from public.crm_customers where workspace_id=p_workspace and id=p_customer;
 if c.id is null then raise exception '404:Customer not found.'; end if;
 if c.merged_into_id is not null then return jsonb_build_object('merged_into',c.merged_into_id); end if;
 return jsonb_build_object(
  'customer',jsonb_build_object('id',c.id,'company',c.company,'name',c.name,'email',c.email,'phone',c.phone,'industry',c.industry,'job_title',c.job_title,'website',c.website,
    'source',c.source,'owner_id',c.owner_id,'identity_review_required',c.identity_review_required,'created_at',c.created_at,'link','/revenue?view=customer&customer='||c.id),
  'contactability',jsonb_build_object('blocked_reason',revenue_private.block_reason(p_workspace,c.email,'reply'),'marketing_blocked_reason',revenue_private.block_reason(p_workspace,c.email,'marketing'),
    'consents',coalesce((select jsonb_agg(x) from (select distinct on (channel,purpose) channel,purpose,status,source,recorded_at from public.revenue_consents where workspace_id=p_workspace and customer_id=c.id order by channel,purpose,recorded_at desc) x),'[]')),
  'memory',jsonb_build_object(
    'facts',coalesce((select jsonb_agg(jsonb_build_object('id',id,'content',content,'source',source,'source_ref',source_ref,'recorded_at',created_at,'confirmed_at',decided_at,'expires_at',expires_at,'visibility',coalesce(visibility,'workspace')) order by created_at desc)
      from public.crm_memories where workspace_id=p_workspace and customer_id=c.id and status='approved' and (expires_at is null or expires_at>now()) and (visibility is distinct from 'owners' or owner)),'[]'),
    'inferences',coalesce((select jsonb_agg(jsonb_build_object('id',id,'content',content,'source',source,'source_ref',source_ref,'confidence',confidence,'recorded_at',created_at,'expires_at',expires_at) order by created_at desc)
      from public.crm_memories where workspace_id=p_workspace and customer_id=c.id and status='proposed' and (expires_at is null or expires_at>now()) and (visibility is distinct from 'owners' or owner)),'[]')),
  'timeline',coalesce((select jsonb_agg(x order by x.occurred_at desc) from (select id,kind,source,actor_type,actor_label,status,summary,occurred_at,recorded_at,subject_type,subject_id,error,recovery,
     (detail->>'untrusted_content')::boolean as untrusted from public.revenue_events where workspace_id=p_workspace and customer_id=c.id order by occurred_at desc limit 40) x),'[]'),
  'open_tasks',coalesce((select jsonb_agg(jsonb_build_object('id',id,'title',title,'due_at',due_at,'kind',coalesce(kind,'task'),'owner_id',owner_id,'overdue',due_at<now()) order by due_at nulls last) from public.crm_tasks where workspace_id=p_workspace and customer_id=c.id and status='open'),'[]'),
  'deals',coalesce((select jsonb_agg(jsonb_build_object('id',id,'title',title,'stage',stage,'value_cents',value_cents,'currency',currency,'owner_id',owner_id,'stage_changed_at',stage_changed_at,'outcome',revenue_private.stage_outcome(p_workspace,stage)) order by created_at desc) from public.crm_deals where workspace_id=p_workspace and customer_id=c.id),'[]'),
  'meetings',coalesce((select jsonb_agg(jsonb_build_object('id',id,'title',title,'starts_at',starts_at,'status',status,'deal_id',deal_id) order by starts_at desc) from public.revenue_meetings where workspace_id=p_workspace and customer_id=c.id),'[]'),
  'proposals',coalesce((select jsonb_agg(jsonb_build_object('id',id,'title',title,'status',status,'amount_cents',amount_cents,'amount_paid_cents',amount_paid_cents,'currency',currency,'sent_at',sent_at) order by created_at desc) from public.revenue_proposals where workspace_id=p_workspace and customer_id=c.id),'[]'),
  'payments',coalesce((select jsonb_agg(jsonb_build_object('id',id,'status',status,'amount_received_cents',amount_received_cents,'amount_refunded_cents',amount_refunded_cents,'currency',currency,'last_event_at',last_event_at,'failure',failure) order by created_at desc) from public.revenue_payments where workspace_id=p_workspace and customer_id=c.id),'[]'),
  'onboarding',coalesce((select jsonb_agg(jsonb_build_object('id',id,'status',status,'started_at',started_at,'hold_reason',hold_reason)) from public.revenue_onboardings where workspace_id=p_workspace and customer_id=c.id),'[]'),
  'threads',coalesce((select jsonb_agg(jsonb_build_object('account_id',account_id,'thread_id',thread_id,'subject',subject,'state',state,'last_inbound_at',last_inbound_at,'last_outbound_at',last_outbound_at,'assigned_to',assigned_to,'labels',labels,'unanswered_questions',unanswered_questions,'untrusted',true) order by last_event_at desc) from public.crm_mail_threads where workspace_id=p_workspace and customer_id=c.id),'[]'),
  'messages',coalesce((select jsonb_agg(jsonb_build_object('id',id,'direction',direction,'status',status,'subject',subject,'to',to_email,'purpose',purpose,'ai_generated',ai_generated,'approval_source',approval_source,'failure',failure,'updated_at',updated_at,'thread_id',thread_id,'untrusted',untrusted) order by created_at desc) from (select * from public.revenue_messages where workspace_id=p_workspace and customer_id=c.id order by created_at desc limit 30) x),'[]'),
  'generated_at',now());
end $$;

-- ---------- company overview ----------
create or replace function public.revenue_overview(p_workspace uuid, p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare env text; mail_connected boolean; stripe_connected boolean; f timestamptz := coalesce(p_from,now()-interval '30 days'); t timestamptz := coalesce(p_to,now());
begin
 perform revenue_private.require_role(p_workspace,'viewer');
 select environment into env from public.crm_workspaces where id=p_workspace;
 mail_connected := exists(select 1 from public.crm_mail_connections where workspace_id=p_workspace);
 stripe_connected := exists(select 1 from public.revenue_integrations where workspace_id=p_workspace and provider='stripe' and status='active');
 return jsonb_build_object(
  'period',jsonb_build_object('from',f,'to',t),
  'environment',env,
  'counts_in_production_reporting',env='production',
  'generated_at',now(),
  'freshness',jsonb_build_object(
    'latest_event_at',(select max(recorded_at) from public.revenue_events where workspace_id=p_workspace),
    'mail_sync',coalesce((select jsonb_agg(jsonb_build_object('account_id',account_id,'status',status,'last_synced_at',last_synced_at,'last_error',last_error,'mailbox',mailbox)) from public.revenue_sync_state where workspace_id=p_workspace),'[]'),
    'integrations',coalesce((select jsonb_agg(jsonb_build_object('provider',provider,'label',label,'status',status,'last_success_at',last_success_at,'last_error',last_error)) from public.revenue_integrations where workspace_id=p_workspace),'[]')),
  'metrics',jsonb_build_object(
   'leads',jsonb_build_object('definition','Customers created in the period from inquiries, forms, Mail or manual entry (merged duplicates excluded; bulk discovery imports listed separately).',
     'total',(select count(*) from public.crm_customers where workspace_id=p_workspace and merged_into_id is null and created_at>=f and created_at<t and source not ilike '%discovery%' and source not ilike '%openstreetmap%'),
     'discovery_imports',(select count(*) from public.crm_customers where workspace_id=p_workspace and created_at>=f and created_at<t and (source ilike '%discovery%' or source ilike '%openstreetmap%')),
     'by_source',coalesce((select jsonb_object_agg(source,n) from (select source,count(*) n from public.crm_customers where workspace_id=p_workspace and merged_into_id is null and created_at>=f and created_at<t group by source order by count(*) desc limit 12) x),'{}'),
     'inquiries',(select count(*) from public.crm_inquiries where workspace_id=p_workspace and received_at>=f and received_at<t),
     'drill','/revenue?view=customers&created_from='||f::date),
   'pipeline',jsonb_build_object('definition','Open opportunities now, by stage; conversion = won / (won + lost) among opportunities closed in the period.',
     'open_by_stage',coalesce((select jsonb_object_agg(stage,jsonb_build_object('count',n,'value_cents',v)) from (select stage,count(*) n,sum(value_cents) v from public.crm_deals where workspace_id=p_workspace and revenue_private.stage_outcome(p_workspace,stage)='open' group by stage) x),'{}'),
     'currencies',coalesce((select jsonb_agg(distinct currency) from public.crm_deals where workspace_id=p_workspace),'[]'),
     'won',(select count(*) from public.crm_deals where workspace_id=p_workspace and revenue_private.stage_outcome(p_workspace,stage)='won' and stage_changed_at>=f and stage_changed_at<t),
     'lost',(select count(*) from public.crm_deals where workspace_id=p_workspace and revenue_private.stage_outcome(p_workspace,stage)='lost' and stage_changed_at>=f and stage_changed_at<t),
     'drill','/revenue?view=pipeline'),
   'outreach',jsonb_build_object('definition','Messages sent through Onixus Mail in the period by actual status. Opens are excluded: they are not evidence of a person reading. Reply rate = threads with a customer reply after our message / threads we sent to.',
     'by_status',coalesce((select jsonb_object_agg(status,n) from (select status,count(*) n from public.revenue_messages where workspace_id=p_workspace and direction='outbound' and created_at>=f and created_at<t group by status) x),'{}'),
     'replies_received',(select count(*) from public.revenue_messages where workspace_id=p_workspace and direction='inbound' and occurred_at>=f and occurred_at<t),
     'threads_sent',(select count(distinct thread_id) from public.revenue_messages where workspace_id=p_workspace and direction='outbound' and provider_accepted_at>=f and provider_accepted_at<t),
     'threads_replied',(select count(distinct thread_id) from public.revenue_messages where workspace_id=p_workspace and direction='outbound' and provider_accepted_at>=f and provider_accepted_at<t and replied_at is not null),
     'awaiting_approval',(select count(*) from public.revenue_messages where workspace_id=p_workspace and status='drafted'),
     'drill','/revenue?view=mail'),
   'bookings',jsonb_build_object('definition','Meetings booked in the period (cancelled shown separately).',
     'scheduled',(select count(*) from public.revenue_meetings where workspace_id=p_workspace and created_at>=f and created_at<t and status<>'cancelled'),
     'cancelled',(select count(*) from public.revenue_meetings where workspace_id=p_workspace and created_at>=f and created_at<t and status='cancelled'),
     'upcoming',(select count(*) from public.revenue_meetings where workspace_id=p_workspace and status='scheduled' and starts_at>now())),
   'proposals',jsonb_build_object('definition','Proposals created in the period by current status.',
     'by_status',coalesce((select jsonb_object_agg(status,jsonb_build_object('count',n,'amount_cents',v)) from (select status,count(*) n,sum(amount_cents) v from public.revenue_proposals where workspace_id=p_workspace and created_at>=f and created_at<t group by status) x),'{}')),
   'payments',jsonb_build_object('definition','Amounts confirmed by signed provider webhooks only. Outstanding = sent or partially paid proposals minus collected.',
     'known',stripe_connected,
     'collected_cents',(select coalesce(sum(amount_received_cents),0) from public.revenue_payments where workspace_id=p_workspace and last_event_at>=f and last_event_at<t),
     'refunded_cents',(select coalesce(sum(amount_refunded_cents),0) from public.revenue_payments where workspace_id=p_workspace and last_event_at>=f and last_event_at<t),
     'failed',(select count(*) from public.revenue_payments where workspace_id=p_workspace and status='failed' and last_event_at>=f and last_event_at<t),
     'outstanding_cents',(select coalesce(sum(amount_cents-amount_paid_cents),0) from public.revenue_proposals where workspace_id=p_workspace and status in ('sent','partially_paid','payment_failed'))),
   'onboarding',jsonb_build_object('definition','Onboardings started in the period, and current state.',
     'started',(select count(*) from public.revenue_onboardings where workspace_id=p_workspace and started_at>=f and started_at<t),
     'active',(select count(*) from public.revenue_onboardings where workspace_id=p_workspace and status='active'),
     'on_hold',(select count(*) from public.revenue_onboardings where workspace_id=p_workspace and status='on_hold')),
   'commitments',jsonb_build_object('definition','Open tasks and commitments past their due time, now.',
     'overdue',(select count(*) from public.crm_tasks where workspace_id=p_workspace and status='open' and due_at<now()),
     'due_today',(select count(*) from public.crm_tasks where workspace_id=p_workspace and status='open' and due_at>=now() and due_at<date_trunc('day',now())+interval '1 day')),
   'failures',jsonb_build_object('definition','Items that need recovery now.',
     'failed_sends',(select count(*) from public.revenue_messages where workspace_id=p_workspace and status='failed'),
     'dead_jobs',(select count(*) from public.revenue_jobs where workspace_id=p_workspace and status='dead'),
     'retrying_jobs',(select count(*) from public.revenue_jobs where workspace_id=p_workspace and status='queued' and attempts>0),
     'sync_problems',(select count(*) from public.revenue_sync_state where workspace_id=p_workspace and status in ('expired','error')),
     'paused',coalesce((select automation_paused from public.revenue_controls where workspace_id=p_workspace),false),
     'identity_reviews',(select count(*) from public.revenue_identity_reviews where workspace_id=p_workspace and status='open'))),
  'unknowns',(select coalesce(jsonb_agg(u),'[]') from (values
    (case when not mail_connected then 'Onixus Mail is not linked to this workspace: outreach and reply counts only include messages created here.' end),
    (case when not stripe_connected then 'No payment integration is connected: payments and collections are unknown, not zero.' end),
    (case when not exists(select 1 from public.revenue_integrations where workspace_id=p_workspace and provider='calendar' and status='active') then 'No calendar integration: bookings only include meetings logged in Onixus CRM.' end),
    (case when (select count(distinct currency) from public.crm_deals where workspace_id=p_workspace)>1 then 'Pipeline values use several currencies and are not summed across currencies.' end),
    (case when env<>'production' then 'This is a '||env||' workspace. Its numbers are excluded from production reporting.' end)) v(u) where u is not null));
end $$;

create or replace function public.revenue_priorities(p_workspace uuid, p_limit integer default 25)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform revenue_private.require_role(p_workspace,'viewer');
 return coalesce((select jsonb_agg(x order by x.severity desc, x.since) from (
  select * from (
   select 3 severity,'failed_send' kind,m.customer_id,c.company who,'A message to '||m.to_email||' failed: '||coalesce(m.failure->>'detail',m.failure->>'reason','unknown error') why,
    case when m.failure->>'reason'='bounce' then 'Verify the address or contact them another way' else 'Fix the cause, then retry the send' end action,m.failed_at since,'/revenue?view=mail&message='||m.id link
   from public.revenue_messages m left join public.crm_customers c on c.id=m.customer_id where m.workspace_id=p_workspace and m.status='failed'
   union all
   select 3,'sync_problem',null,coalesce(s.mailbox,'Mail account'),'Mail sync is '||s.status||coalesce(': '||s.last_error,''),case when s.status='expired' then 'Reconnect Google in Onixus Mail' else 'Retry sync and check Mail service health' end,s.last_attempt_at,'/revenue?view=mail'
   from public.revenue_sync_state s where s.workspace_id=p_workspace and s.status in ('expired','error')
   union all
   select 3,'dead_job',j.customer_id,coalesce(c.company,'Workflow'),'Automation step '||j.kind||' failed after '||j.attempts||' attempts: '||coalesce(j.last_error,''),'Review the error and replay the job',j.finished_at,'/revenue?view=automation&job='||j.id
   from public.revenue_jobs j left join public.crm_customers c on c.id=j.customer_id where j.workspace_id=p_workspace and j.status='dead' and j.kind<>'mail.send'
   union all
   select 2,'payment_failed',p.customer_id,c.company,'Payment failed for "'||p.title||'"','Send a new payment link or contact the customer',p.updated_at,'/revenue?view=customer&customer='||p.customer_id
   from public.revenue_proposals p join public.crm_customers c on c.id=p.customer_id where p.workspace_id=p_workspace and p.status='payment_failed'
   union all
   select 2,'onboarding_hold',o.customer_id,c.company,'Onboarding is on hold: '||coalesce(o.hold_reason,''),'Review the refund or cancellation with the customer',o.started_at,'/revenue?view=customer&customer='||o.customer_id
   from public.revenue_onboardings o join public.crm_customers c on c.id=o.customer_id where o.workspace_id=p_workspace and o.status='on_hold'
   union all
   select 2,'awaiting_reply',t.customer_id,c.company,'Customer wrote "'||left(t.subject,120)||'" and is waiting for a reply'||case when jsonb_array_length(coalesce(t.unanswered_questions,'[]'))>0 then ' ('||jsonb_array_length(t.unanswered_questions)||' open question(s))' else '' end,
    'Draft and approve a reply',t.last_inbound_at,'/revenue?view=mail&thread='||t.thread_id
   from public.crm_mail_threads t join public.crm_customers c on c.id=t.customer_id where t.workspace_id=p_workspace and t.state='waiting_on_us' and t.last_inbound_at<now()-interval '4 hours'
   union all
   select 2,'overdue_task',k.customer_id,c.company,'"'||k.title||'" was due '||to_char(k.due_at at time zone 'UTC','YYYY-MM-DD'),'Complete it or set a new date',k.due_at,'/revenue?view=customer&customer='||k.customer_id
   from public.crm_tasks k join public.crm_customers c on c.id=k.customer_id where k.workspace_id=p_workspace and k.status='open' and k.due_at<now()
   union all
   select 1,'drafts_waiting',m.customer_id,c.company,'A draft to '||m.to_email||' is waiting for approval','Review and approve or cancel it',m.created_at,'/revenue?view=mail&message='||m.id
   from public.revenue_messages m left join public.crm_customers c on c.id=m.customer_id where m.workspace_id=p_workspace and m.status='drafted' and m.direction='outbound'
   union all
   select 1,'identity_review',r.customer_id,c.company,'Possible duplicate customer ('||replace(r.reason,'_',' ')||')','Merge or mark as different',r.created_at,'/revenue?view=reviews'
   from public.revenue_identity_reviews r join public.crm_customers c on c.id=r.customer_id where r.workspace_id=p_workspace and r.status='open'
   union all
   select 1,'proposal_unpaid',p.customer_id,c.company,'Proposal "'||p.title||'" sent '||to_char(p.sent_at at time zone 'UTC','YYYY-MM-DD')||' is not paid','Follow up on the proposal',p.sent_at,'/revenue?view=customer&customer='||p.customer_id
   from public.revenue_proposals p join public.crm_customers c on c.id=p.customer_id where p.workspace_id=p_workspace and p.status='sent' and p.sent_at<now()-interval '5 days'
  ) all_items order by severity desc, since nulls last limit greatest(1,least(p_limit,100))) x),'[]');
end $$;

do $$ declare t text; begin
 foreach t in array array['revenue_meetings','revenue_proposals','revenue_payments','revenue_onboardings','revenue_engagements'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('grant all on public.%I to service_role',t);
  execute format('drop policy if exists revenue_member_read on public.%I',t);
  execute format('create policy revenue_member_read on public.%I for select to authenticated using (workspace_id in (select workspace_id from public.crm_memberships where user_id=(select auth.uid())))',t);
 end loop;
end $$;
alter table public.revenue_provider_events enable row level security;
revoke all on public.revenue_provider_events from public,anon,authenticated;
grant select on public.revenue_provider_events to authenticated;
drop policy if exists revenue_owner_read on public.revenue_provider_events;
create policy revenue_owner_read on public.revenue_provider_events for select to authenticated using (revenue_private.is_owner(workspace_id));

do $$ declare f text; begin
 foreach f in array array['revenue_book_meeting(uuid,uuid,uuid,text,timestamptz,timestamptz)','revenue_create_proposal(uuid,uuid,uuid,text,bigint,text,text,integer,jsonb)',
  'revenue_mark_proposal_sent(uuid,uuid,text,text)','revenue_cancel_proposal(uuid,uuid,text)','revenue_proposal_status(uuid,uuid)','revenue_customer_context(uuid,uuid)',
  'revenue_overview(uuid,timestamptz,timestamptz)','revenue_priorities(uuid,integer)'] loop
  execute 'revoke all on function public.'||f||' from public, anon';
  execute 'grant execute on function public.'||f||' to authenticated';
 end loop;
 foreach f in array array['revenue_ingest_form(uuid,text,jsonb)','revenue_ingest_calendar_event(uuid,text,jsonb)','revenue_ingest_payment_event(uuid,text,jsonb)'] loop
  execute 'revoke all on function public.'||f||' from public';
  execute 'grant execute on function public.'||f||' to anon, authenticated';
 end loop;
 foreach f in array array['revenue_private.upsert_meeting(uuid,uuid,uuid,text,timestamptz,timestamptz,text,text,text,timestamptz,text)','revenue_private.run_internal_job(uuid,text)'] loop
  execute 'revoke all on function '||f||' from public, anon, authenticated';
 end loop;
end $$;
commit;
