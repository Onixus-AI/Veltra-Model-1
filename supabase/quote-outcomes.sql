-- Structured Mail outcomes, bound to the existing explicitly linked workspace.
begin;
alter table public.crm_mail_threads add column if not exists quote_outcome jsonb;
create or replace function public.crm_ingest_quote_outcome(p_account uuid,p_token text,p_event uuid,p_email text,p_subject text,p_thread text,p_at timestamptz,p_outcome jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare w uuid;receipt jsonb;stamp timestamptz;
begin
 w:=crm_private.mail_workspace(p_account,p_token);
 if p_thread is null or p_thread='' or jsonb_typeof(p_outcome) is distinct from 'object' or octet_length(p_outcome::text)>10000 then raise exception 'Invalid quote outcome'; end if;
 if coalesce(p_outcome->>'status','') not in ('WAITING','REPLIED','WON','LOST') or coalesce(p_outcome->>'reason','') not in ('price','timing','availability','service_fit','competitor','other','unknown') or coalesce(p_outcome->>'reason_source','') not in ('unknown','customer_stated','owner_assessment') then raise exception 'Invalid quote classification'; end if;
 if p_outcome->>'status'<>'LOST' and (p_outcome->>'reason'<>'unknown' or p_outcome->>'reason_source'<>'unknown') then raise exception 'Only reviewed lost quotes can have loss reasons'; end if;
 if p_outcome->>'reason_source'='unknown' and p_outcome->>'reason'<>'unknown' then raise exception 'A reason requires a source'; end if;
 if p_outcome->>'reason_source' in ('customer_stated','owner_assessment') and nullif(trim(p_outcome->>'evidence'),'') is null then raise exception 'Evidence is required'; end if;
 if p_outcome->>'reason_source'='customer_stated' and nullif(p_outcome->>'source_message_id','') is null then raise exception 'A source message is required'; end if;
 if length(coalesce(p_outcome->>'evidence',''))>1500 or length(coalesce(p_outcome->>'quote_excerpt',''))>1000 or length(coalesce(p_outcome->>'source_message_id',''))>1000 then raise exception 'Quote evidence too large'; end if;
 stamp:=(p_outcome->>'updated_at')::timestamptz;
 if stamp is null or stamp>now()+interval '10 minutes' or stamp<now()-interval '2 years' then raise exception 'Invalid outcome timestamp'; end if;
 receipt:=public.crm_ingest_mail(p_account,p_token,p_event,'service.event',p_email,left('Quote '||(p_outcome->>'status')||' / '||(p_outcome->>'reason')||' / '||(p_outcome->>'reason_source')||': '||coalesce(p_subject,''),500),p_thread,p_at);
 if coalesce((receipt->>'duplicate')::boolean,false) then return receipt; end if;
 update public.crm_mail_threads set quote_outcome=p_outcome,subject=coalesce(p_subject,'') where account_id=p_account and workspace_id=w and thread_id=p_thread and (quote_outcome is null or (quote_outcome->>'updated_at')::timestamptz<=stamp);
 return receipt;
end $$;
revoke all on function public.crm_ingest_quote_outcome(uuid,text,uuid,text,text,text,timestamptz,jsonb) from public;
grant execute on function public.crm_ingest_quote_outcome(uuid,text,uuid,text,text,text,timestamptz,jsonb) to anon,authenticated;
commit;
