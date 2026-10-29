begin;
create table public.workspace_report_settings(
 workspace_id uuid primary key references public.crm_workspaces(id) on delete cascade,
 enabled boolean not null default false, time_zone text not null, report_hour integer not null check(report_hour between 0 and 23),
 authorized_by uuid not null, updated_at timestamptz not null default now()
);
create table public.workspace_daily_reports(
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.crm_workspaces(id) on delete cascade,
 report_day date not null, period_start timestamptz not null, period_end timestamptz not null,
 time_zone text not null, report jsonb not null, created_at timestamptz not null default now(),
 email_message_id uuid references public.revenue_messages(id), email_error text, email_last_attempt_at timestamptz,
 delivery text not null default 'workspace' check(delivery='workspace'), unique(workspace_id,report_day),check(period_start<period_end)
);
alter table public.workspace_report_settings enable row level security;
alter table public.workspace_daily_reports enable row level security;
revoke all on public.workspace_report_settings,public.workspace_daily_reports from public,anon,authenticated;
grant select on public.workspace_report_settings,public.workspace_daily_reports to authenticated,service_role;
create policy report_settings_members on public.workspace_report_settings for select to authenticated using(exists(select 1 from public.crm_memberships m where m.workspace_id=workspace_report_settings.workspace_id and m.user_id=(select auth.uid())));
create policy daily_reports_members on public.workspace_daily_reports for select to authenticated using(exists(select 1 from public.crm_memberships m where m.workspace_id=workspace_daily_reports.workspace_id and m.user_id=(select auth.uid())));
create index daily_reports_recent on public.workspace_daily_reports(workspace_id,period_end desc);
create function public.workspace_report_settings_set(p_workspace uuid,p_enabled boolean,p_time_zone text,p_hour integer) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.crm_memberships where workspace_id=p_workspace and user_id=auth.uid() and role='owner') then raise exception 'Business owner required';end if;
 if p_enabled is null or p_hour is null or p_hour not between 0 and 23 or not exists(select 1 from pg_timezone_names where name=p_time_zone) then raise exception 'Valid timezone and hour required';end if;
 if p_enabled and not exists(select 1 from public.crm_workspaces w join auth.users u on u.id=w.owner_id where w.id=p_workspace and u.email_confirmed_at is not null and u.email is not null) then raise exception 'Business owner must have a verified email';end if;
 insert into public.workspace_report_settings(workspace_id,enabled,time_zone,report_hour,authorized_by) values(p_workspace,p_enabled,p_time_zone,p_hour,auth.uid())
 on conflict(workspace_id) do update set enabled=excluded.enabled,time_zone=excluded.time_zone,report_hour=excluded.report_hour,authorized_by=excluded.authorized_by,updated_at=now();
 if not p_enabled then
 update public.revenue_jobs set status='cancelled',cancel_reason='Daily reporting paused',finished_at=now(),updated_at=now() where workspace_id=p_workspace and workflow_key='owner_daily_report' and status='queued';
 update public.revenue_messages set status='cancelled',failure=jsonb_build_object('reason','Daily reporting paused'),updated_at=now() where workspace_id=p_workspace and automation_key='owner_daily_report' and status in ('approved','queued');
 end if;
end $$;
revoke all on function public.workspace_report_settings_set(uuid,boolean,text,integer) from public,anon;
grant execute on function public.workspace_report_settings_set(uuid,boolean,text,integer) to authenticated;
-- This helper is reachable only through owner/member-checked preview or the service-only generator.
create function public.workspace_report_data(p_workspace uuid,p_from timestamptz,p_to timestamptz) returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object(
 'generated_at',now(),'period_start',p_from,'period_end',p_to,
 'source_jobs_completed',(select count(*) from public.revenue_jobs where coalesce(workflow_key,'')<>'owner_daily_report' and workspace_id=p_workspace and status='succeeded' and finished_at>=p_from and finished_at<p_to),
 'source_jobs_failed',(select count(*) from public.revenue_jobs where coalesce(workflow_key,'')<>'owner_daily_report' and workspace_id=p_workspace and status='dead' and updated_at>=p_from and updated_at<p_to),
 'source_jobs_active',(select count(*) from public.revenue_jobs where coalesce(workflow_key,'')<>'owner_daily_report' and workspace_id=p_workspace and status in ('queued','running')),
 'mail_provider_accepted',(select count(*) from public.revenue_messages where coalesce(automation_key,'')<>'owner_daily_report' and workspace_id=p_workspace and direction='outbound' and provider_accepted_at>=p_from and provider_accepted_at<p_to),
 'mail_delivered',(select count(*) from public.revenue_messages where coalesce(automation_key,'')<>'owner_daily_report' and workspace_id=p_workspace and direction='outbound' and delivered_at>=p_from and delivered_at<p_to),
 'mail_incoming',(select count(*) from public.revenue_messages where coalesce(automation_key,'')<>'owner_daily_report' and workspace_id=p_workspace and direction='inbound' and created_at>=p_from and created_at<p_to),
 'mail_awaiting_review',(select count(*) from public.revenue_messages where coalesce(automation_key,'')<>'owner_daily_report' and workspace_id=p_workspace and status='drafted'),
 'overdue_commitments',(select count(*) from public.crm_tasks where workspace_id=p_workspace and status='open' and due_at<now()),
 'new_customer_records',(select count(*) from public.crm_customers where workspace_id=p_workspace and created_at>=p_from and created_at<p_to),
 'tool_failures',(select count(*) from public.workspace_business_events where workspace_id=p_workspace and status='failed' and created_at>=p_from and created_at<p_to),
 'completed_jobs',coalesce((select jsonb_agg(to_jsonb(x)) from(select id,kind,finished_at from public.revenue_jobs where coalesce(workflow_key,'')<>'owner_daily_report' and workspace_id=p_workspace and status='succeeded' and finished_at>=p_from and finished_at<p_to order by finished_at desc limit 20)x),'[]'),
 'agent_steps',coalesce((select jsonb_agg(x.step) from(select jsonb_build_object('job_id',j.id,'member',r->>'member','action',r->>'action','at',r->>'at') step from public.workspace_team_jobs j cross join lateral jsonb_array_elements(j.receipts)r where j.workspace_id=p_workspace and r->>'status'='completed' and r->>'member' in ('onyx','onixa','onixelia') and (r->>'at')::timestamptz>=p_from and (r->>'at')::timestamptz<p_to order by (r->>'at')::timestamptz desc limit 40)x),'[]'),
 'reported_model_cost_usd',(select sum((r->>'cost_usd')::numeric) from public.workspace_team_jobs j cross join lateral jsonb_array_elements(j.receipts)r where j.workspace_id=p_workspace and jsonb_typeof(r->'cost_usd')='number' and (r->>'at')::timestamptz>=p_from and (r->>'at')::timestamptz<p_to),
 'coverage',jsonb_build_array('Workspace job and agent receipts; CRM records and commitments; Mail source records.','Provider acceptance is not delivery. Imported mail does not prove an agent sent it.','Customer records are not qualified leads. Agent-step examples are limited to 40 and completed-job examples to 20.','Source queue backlogs are checked at generation time. Total AI cost and social publishing outcomes are not available from these sources.'));
$$;
revoke all on function public.workspace_report_data(uuid,timestamptz,timestamptz) from public,anon,authenticated,service_role;
create function public.workspace_report_preview(p_workspace uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.crm_memberships where workspace_id=p_workspace and user_id=auth.uid()) then raise exception 'Business membership required';end if;
 return public.workspace_report_data(p_workspace,now()-interval '24 hours',now());
end $$;
revoke all on function public.workspace_report_preview(uuid) from public,anon;
grant execute on function public.workspace_report_preview(uuid) to authenticated;
create function public.workspace_report_queue_email(p_report uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare r public.workspace_daily_reports; cfg public.workspace_report_settings; ident public.revenue_sender_identities; recipient text; message uuid; content text;
begin
 select * into r from public.workspace_daily_reports where id=p_report for update;
 if not found then return null;end if;
 if r.email_message_id is not null then return r.email_message_id;end if;
 update public.workspace_daily_reports set email_last_attempt_at=now() where id=r.id;
 select * into cfg from public.workspace_report_settings where workspace_id=r.workspace_id and enabled;
 if not found or not exists(select 1 from public.crm_memberships where workspace_id=r.workspace_id and user_id=cfg.authorized_by and role='owner') then return null;end if;
 select lower(u.email) into recipient from public.crm_workspaces w join auth.users u on u.id=w.owner_id where w.id=r.workspace_id and u.email_confirmed_at is not null;
 if recipient is null then update public.workspace_daily_reports set email_error='Business owner email is not verified' where id=r.id;return null;end if;
 select s.* into ident from public.revenue_sender_identities s where s.workspace_id=r.workspace_id and s.account_id is not null and exists(select 1 from public.crm_mail_connections c where c.workspace_id=r.workspace_id and c.account_id=s.account_id) order by (s.email=recipient) desc,s.created_at limit 1;
 if ident.id is null then update public.workspace_daily_reports set email_error='Connect a Mail sender to this business' where id=r.id;return null;end if;
 content:=format(E'Onixus daily business report — %s\n\nPeriod: %s to %s (%s)\nCompleted source jobs: %s\nFailed source jobs: %s\nActive source jobs: %s\nEmails accepted by provider: %s\nEmails with delivery receipts: %s\nIncoming messages recorded: %s\nMail drafts awaiting review: %s\nOverdue commitments: %s\nNew customer records (not qualified leads): %s\nFailed tool calls: %s\n\nRecorded team steps: %s\n\nReported model cost (partial): %s USD. Total model cost is not available.\n\nBuild: Onyx leads, repairs and improves. Grow: Onixa owns sales and marketing. Automate: Onixelia owns workflows and handoffs. Onyx supports every lane.\n\nOpen the saved report: https://veltra-model-1.vercel.app/workspace/team?workspace=%s&report=%s\n\nProvider acceptance is not delivery. Imported email is not proof that an agent sent it. No recorded agent steps means no agent execution is verified. Reply and backlog counts describe source records, not completed sales. Social publishing outcomes are not available in this report.\nPause daily reports in Workspace > Business Team.',r.report_day,r.period_start,r.period_end,r.time_zone,r.report->>'source_jobs_completed',r.report->>'source_jobs_failed',r.report->>'source_jobs_active',r.report->>'mail_provider_accepted',r.report->>'mail_delivered',r.report->>'mail_incoming',r.report->>'mail_awaiting_review',r.report->>'overdue_commitments',r.report->>'new_customer_records',r.report->>'tool_failures',r.report->'agent_steps',coalesce(r.report->>'reported_model_cost_usd','unknown'),r.workspace_id,r.id);
 insert into public.revenue_messages(workspace_id,account_id,direction,purpose,status,to_email,from_email,subject,body,sender_identity_id,signature_snapshot,reply_to_snapshot,created_by,approved_by,approved_at,approval_source,automation_key,idempotency_key)
 values(r.workspace_id,ident.account_id,'outbound','transactional','approved',recipient,ident.email,'Onixus daily report — '||r.report_day,content,ident.id,ident.signature,ident.reply_to,cfg.authorized_by,cfg.authorized_by,now(),'automation','owner_daily_report','owner-report:'||r.id)
 on conflict(workspace_id,idempotency_key) do nothing returning id into message;
 if message is null then select id into message from public.revenue_messages where workspace_id=r.workspace_id and idempotency_key='owner-report:'||r.id;end if;
 perform revenue_private.queue_send(message,0,null);
 update public.workspace_daily_reports set email_message_id=message,email_error=null where id=r.id;
 return message;
end $$;
revoke all on function public.workspace_report_queue_email(uuid) from public,anon,authenticated,service_role;
create function public.workspace_generate_daily_reports() returns integer language plpgsql security definer set search_path='' as $$
declare cfg public.workspace_report_settings; d date; cutoff timestamptz; start_at timestamptz; rid uuid; queued uuid; n integer:=0;
begin
 for cfg in select s.* from public.workspace_report_settings s where s.enabled and exists(select 1 from public.crm_memberships m where m.workspace_id=s.workspace_id and m.user_id=s.authorized_by and m.role='owner') order by (select r.email_last_attempt_at from public.workspace_daily_reports r where r.workspace_id=s.workspace_id and r.report_day=(now() at time zone s.time_zone)::date) nulls first,s.updated_at loop
 exit when n>=10;
 d:=(now() at time zone cfg.time_zone)::date;
 cutoff:=(d::timestamp+make_interval(hours=>cfg.report_hour)) at time zone cfg.time_zone;
 if now()<cutoff or cutoff<cfg.updated_at then continue;end if;
 if not pg_try_advisory_xact_lock(hashtextextended('daily-report:'||cfg.workspace_id::text,0)) then continue;end if;
 select id,email_message_id into rid,queued from public.workspace_daily_reports where workspace_id=cfg.workspace_id and report_day=d;
 if rid is not null then if queued is null then perform public.workspace_report_queue_email(rid);n:=n+1;end if;continue;end if;
 select max(period_end) into start_at from public.workspace_daily_reports where workspace_id=cfg.workspace_id;
 start_at:=greatest(coalesce(start_at,cfg.updated_at),((d-1)::timestamp+make_interval(hours=>cfg.report_hour)) at time zone cfg.time_zone);
 if start_at>=cutoff then continue;end if;
 insert into public.workspace_daily_reports(workspace_id,report_day,period_start,period_end,time_zone,report) values(cfg.workspace_id,d,start_at,cutoff,cfg.time_zone,public.workspace_report_data(cfg.workspace_id,start_at,cutoff)) on conflict do nothing returning id into rid;
 if rid is not null then perform public.workspace_report_queue_email(rid);end if;
 n:=n+1;
 end loop;
 return n;
end $$;
revoke all on function public.workspace_generate_daily_reports() from public,anon,authenticated;
grant execute on function public.workspace_generate_daily_reports() to service_role;
create or replace function revenue_private.job_gate(p_job public.revenue_jobs, p_worker text) returns boolean
language plpgsql security definer set search_path='' as $$
declare ctl public.revenue_controls; spent bigint;
begin
 if p_job.workflow_key='owner_daily_report' and not exists(
 select 1 from public.workspace_report_settings cfg join public.crm_workspaces w on w.id=cfg.workspace_id join auth.users u on u.id=w.owner_id join public.revenue_messages m on m.id=p_job.message_id
 where cfg.workspace_id=p_job.workspace_id and cfg.enabled and u.email_confirmed_at is not null and lower(u.email)=lower(m.to_email)
 and exists(select 1 from public.crm_memberships mm where mm.workspace_id=cfg.workspace_id and mm.user_id=cfg.authorized_by and mm.role='owner')) then
 update public.revenue_jobs set status='cancelled',cancel_reason='Report recipient or authorization changed',finished_at=now(),updated_at=now() where id=p_job.id;
 update public.revenue_messages set status='cancelled',failure=jsonb_build_object('reason','Report recipient or authorization changed'),updated_at=now() where id=p_job.message_id and status='queued';
 return false;
 end if;
 select * into ctl from public.revenue_controls where workspace_id=p_job.workspace_id;
 if coalesce(ctl.automation_paused,false) then
  update public.revenue_jobs set last_error='Workspace automation is paused',updated_at=now() where id=p_job.id and last_error is distinct from 'Workspace automation is paused';
  return false;
 end if;
 if p_job.cost_cents>0 then
  select coalesce(sum(cost_cents),0) into spent from public.revenue_jobs where workspace_id=p_job.workspace_id and status='succeeded' and finished_at>=date_trunc('day',now());
  if spent+p_job.cost_cents>coalesce(ctl.daily_spend_limit_cents,0) then
   update public.revenue_jobs set run_at=date_trunc('day',now())+interval '1 day',last_error='Daily spending limit reached',updated_at=now() where id=p_job.id;
   insert into public.revenue_job_runs(job_id,workspace_id,attempt,worker,finished_at,outcome,error) values(p_job.id,p_job.workspace_id,p_job.attempts,p_worker,now(),'deferred','Daily spending limit reached');
   return false;
  end if;
 end if;
 return true;
end $$;
do $$ begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
 perform cron.schedule('onixus-daily-business-reports','*/5 * * * *','select public.workspace_generate_daily_reports();');
 end if;
end $$;
commit;
