create or replace function public.crm_ingest_mail(p_account uuid,p_token text,p_event uuid,p_kind text,p_email text,p_subject text,p_thread text,p_at timestamptz) returns jsonb language plpgsql security definer set search_path='' as $$
declare w uuid;c uuid;n integer;mail text;
begin
 w:=crm_private.mail_workspace(p_account,p_token);
 if p_kind not in('email.received','email.replied','follow_up.sent','service.event') then raise exception 'Unsupported Mail event'; end if;
 mail:=lower(trim(p_email));
 if mail is null or length(mail)>254 or mail !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Invalid contact email'; end if;
 if p_event is null or p_at is null or p_at>now()+interval '10 minutes' or p_at<now()-interval '2 years' or length(coalesce(p_subject,''))>500 or length(coalesce(p_thread,''))>500 then raise exception 'Invalid Mail event'; end if;
 -- Serialize contact matching per workspace/email; ambiguous identities require review.
 perform pg_advisory_xact_lock(hashtextextended(w::text||':'||mail,0));
 if exists(select 1 from crm_private.mail_receipts where account_id=p_account and event_id=p_event) then return jsonb_build_object('duplicate',true); end if;
 select count(*) into n from public.crm_customers where workspace_id=w and email=mail;
 if n>1 then raise exception 'Ambiguous customer identity: review matching records'; end if;
 select id into c from public.crm_customers where workspace_id=w and email=mail;
 if c is null then insert into public.crm_customers(workspace_id,company,email,source) values(w,mail,mail,'Veltra Mail') returning id into c; end if;
 insert into crm_private.mail_receipts(account_id,event_id,customer_id) values(p_account,p_event,c);
 if nullif(p_thread,'') is not null then
 insert into public.crm_mail_threads(account_id,thread_id,workspace_id,customer_id,subject,last_event_at)
 values(p_account,p_thread,w,c,coalesce(p_subject,''),p_at) on conflict(workspace_id,account_id,thread_id) do update set
 last_event_at=greatest(public.crm_mail_threads.last_event_at,excluded.last_event_at),subject=excluded.subject;
 end if;
 insert into public.crm_activity(workspace_id,customer_id,kind,title,created_at) values(w,c,p_kind,
 case p_kind when 'email.received' then 'Email received' when 'email.replied' then 'Reply sent' when 'service.event' then 'Operations update' else 'Follow-up sent' end || case when nullif(p_subject,'') is not null then ': '||p_subject else '' end,p_at);
 if p_kind='email.received' then
  insert into public.crm_tasks(workspace_id,customer_id,title,due_at) values(w,c,'Review customer email and agree next action',now()+interval '1 day');
 end if;
 return jsonb_build_object('duplicate',false,'customer_id',c,'workspace_id',w);
end $$;

revoke all on function public.crm_ingest_mail(uuid,text,uuid,text,text,text,text,timestamptz) from public;
grant execute on function public.crm_ingest_mail(uuid,text,uuid,text,text,text,text,timestamptz) to anon,authenticated;
