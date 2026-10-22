-- Additive customer enquiry intake. No automatic deals, tasks, outreach or payments.
begin;
-- Support the workspace-wide snapshot order, without changing totals or records.
create index if not exists crm_customers_workspace_created on public.crm_customers(workspace_id,created_at desc,id);
create index if not exists crm_deals_workspace_created on public.crm_deals(workspace_id,created_at desc,id);
create index if not exists crm_tasks_workspace_created on public.crm_tasks(workspace_id,created_at desc,id);
create index if not exists crm_memories_workspace_created on public.crm_memories(workspace_id,created_at desc,id);
create index if not exists crm_activity_workspace_created on public.crm_activity(workspace_id,created_at desc,id);
create table public.crm_inquiries (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null,
 customer_id uuid not null,
 subject text not null check(length(trim(subject)) between 1 and 200),
 message text not null check(length(trim(message)) between 1 and 4000),
 source text not null check(source in ('phone','email','website','referral','other')),
 status text not null default 'new' check(status in ('new','reviewing','closed')),
 created_by uuid not null default auth.uid() references auth.users(id),
 received_at timestamptz not null default now(),
 created_at timestamptz not null default now(),
 foreign key(workspace_id,customer_id) references public.crm_customers(workspace_id,id)
);
create index crm_inquiries_customer on public.crm_inquiries(workspace_id,customer_id,created_at desc,id);
alter table public.crm_inquiries enable row level security;
revoke all on public.crm_inquiries from public,anon,authenticated;
grant select on public.crm_inquiries to authenticated;
grant insert(id,workspace_id,customer_id,subject,message,source,received_at) on public.crm_inquiries to authenticated;
grant update(status) on public.crm_inquiries to authenticated;
grant all on public.crm_inquiries to service_role;
create policy inquiries_read on public.crm_inquiries for select to authenticated using(
 workspace_id in(select workspace_id from public.crm_memberships where user_id=(select auth.uid()))
);
create policy inquiries_insert on public.crm_inquiries for insert to authenticated with check(
 created_by=(select auth.uid()) and workspace_id in(select workspace_id from public.crm_memberships where user_id=(select auth.uid()) and role in('owner','member'))
);
create policy inquiries_update on public.crm_inquiries for update to authenticated using(
 workspace_id in(select workspace_id from public.crm_memberships where user_id=(select auth.uid()) and role in('owner','member'))
) with check(
 workspace_id in(select workspace_id from public.crm_memberships where user_id=(select auth.uid()) and role in('owner','member'))
);
commit;
