begin;
alter table public.crm_customers add column if not exists archived_at timestamptz;
alter table public.crm_customers add column if not exists archive_reason text;
alter table public.crm_customers add column if not exists reconciliation_status text;
-- Incomplete imports remain available for research, never ready for outreach.
create or replace function public.crm_contact_admission_gate() returns trigger language plpgsql set search_path='' as $$
begin
 if new.email is null or btrim(new.email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or coalesce(new.source,'') !~ '^https://[^/[:space:]]+' then
  new.identity_review_required:=true;new.reconciliation_status:='pending';
 end if;
 return new;
end;$$;
drop trigger if exists crm_contact_admission_gate on public.crm_customers;
create trigger crm_contact_admission_gate before insert on public.crm_customers for each row execute function public.crm_contact_admission_gate();
create index if not exists crm_customers_reconciliation_idx on public.crm_customers(workspace_id,created_at,id) where archived_at is null and (email is null or identity_review_required);
create or replace function public.crm_archive_unresolved(p_workspace uuid,p_customer uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.crm_customers;begin
 if auth.uid() is null or not exists(select 1 from public.crm_memberships where workspace_id=p_workspace and user_id=auth.uid() and role in ('owner','member')) then raise exception 'Business editor required';end if;
 if length(trim(p_reason))<10 or length(p_reason)>1000 then raise exception 'Research reason required';end if;
 select * into c from public.crm_customers where workspace_id=p_workspace and id=p_customer for update;
 if not found then raise exception 'Customer unavailable';end if;
 if c.archived_at is not null then return jsonb_build_object('status','archived','customer_id',c.id,'archived_at',c.archived_at);end if;
 if nullif(trim(c.email),'') is not null and not c.identity_review_required then raise exception 'Record already has a resolved email';end if;
 if not exists(select 1 from public.crm_contact_research where workspace_id=p_workspace and customer_id=p_customer and completed_at is not null and last_error is null and jsonb_array_length(coalesce(to_jsonb(pages),'[]'::jsonb))>0) then raise exception 'Complete successful source research before archiving';end if;
 if exists(select 1 from public.crm_contact_evidence where workspace_id=p_workspace and customer_id=p_customer) then raise exception 'Review existing contact evidence before declaring unresolved';end if;
 if exists(select 1 from public.crm_deals where workspace_id=p_workspace and customer_id=p_customer and stage not in ('won','lost')) or exists(select 1 from public.crm_tasks where workspace_id=p_workspace and customer_id=p_customer and status='open') then raise exception 'Review open work before archiving';end if;
 update public.crm_customers set archived_at=now(),archive_reason=trim(p_reason),reconciliation_status='unresolved',suppressed=true where id=p_customer;
 insert into public.crm_activity(workspace_id,customer_id,kind,title) values(p_workspace,p_customer,'reconciliation.archived','Onixa reconciliation: unresolved record archived after source research');
 return jsonb_build_object('status','archived','customer_id',p_customer,'reason',trim(p_reason));
end;$$;
revoke all on function public.crm_archive_unresolved(uuid,uuid,text) from public,anon;
grant execute on function public.crm_archive_unresolved(uuid,uuid,text) to authenticated;
create or replace function public.crm_restore_archived(p_workspace uuid,p_customer uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.crm_memberships where workspace_id=p_workspace and user_id=auth.uid() and role in ('owner','member')) then raise exception 'Business editor required';end if;
 update public.crm_customers set archived_at=null,archive_reason=null,reconciliation_status=null where workspace_id=p_workspace and id=p_customer and archived_at is not null;
 if not found then raise exception 'Archived company unavailable';end if;
 insert into public.crm_activity(workspace_id,customer_id,kind,title) values(p_workspace,p_customer,'reconciliation.restored','Archived company restored for contact reconciliation; outreach remains suppressed');
 return jsonb_build_object('status','restored','customer_id',p_customer,'outreach','suppressed');
end;$$;
revoke all on function public.crm_restore_archived(uuid,uuid) from public,anon;
grant execute on function public.crm_restore_archived(uuid,uuid) to authenticated;
commit;
