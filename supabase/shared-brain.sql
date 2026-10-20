-- Apply once after schema.sql and suite.sql, to the shared Chat/CRM identity project.
begin;
create table public.veltra_memories (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null default auth.uid() references auth.users(id),
 workspace_id uuid references public.crm_workspaces(id),customer_id uuid,
 content text not null check(length(trim(content)) between 1 and 4000),
 kind text not null default 'fact' check(kind in('fact','preference','procedure','project')),
 source_app text not null check(source_app in('chat','mail','crm')),
 source_ref text not null check(length(trim(source_ref)) between 1 and 500),
 status text not null default 'proposed' check(status in('proposed','approved')),
 revision integer not null default 0 check(revision>=0),
 expires_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check(customer_id is null or workspace_id is not null),
 foreign key(workspace_id,customer_id) references public.crm_customers(workspace_id,id)
);
create index veltra_memories_workspace on public.veltra_memories(workspace_id,customer_id,status,updated_at desc);
create index veltra_memories_personal on public.veltra_memories(user_id,updated_at desc) where workspace_id is null;
alter table public.veltra_memories enable row level security;
revoke all on public.veltra_memories from public,anon,authenticated;
grant select,insert,update,delete on public.veltra_memories to authenticated;
create policy brain_read on public.veltra_memories for select to authenticated using(
 (workspace_id is null and user_id=(select auth.uid())) or
 workspace_id in(select workspace_id from public.crm_memberships where user_id=(select auth.uid()))
);
create policy brain_insert on public.veltra_memories for insert to authenticated with check(
 user_id=(select auth.uid()) and ((workspace_id is null) or
 workspace_id in(select workspace_id from public.crm_memberships where user_id=(select auth.uid()) and role in('owner','member')))
);
create policy brain_update on public.veltra_memories for update to authenticated using(
 (workspace_id is null and user_id=(select auth.uid())) or
 workspace_id in(select workspace_id from public.crm_memberships where user_id=(select auth.uid()) and role in('owner','member'))
) with check(
 (workspace_id is null and user_id=(select auth.uid())) or
 workspace_id in(select workspace_id from public.crm_memberships where user_id=(select auth.uid()) and role in('owner','member'))
);
create policy brain_delete on public.veltra_memories for delete to authenticated using(
 (workspace_id is null and user_id=(select auth.uid())) or
 workspace_id in(select workspace_id from public.crm_memberships where user_id=(select auth.uid()) and role in('owner','member'))
);
-- Even direct Data API callers cannot move knowledge between scopes or authors.
create function public.veltra_memory_version() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.id is distinct from old.id or new.user_id is distinct from old.user_id or
 new.workspace_id is distinct from old.workspace_id or new.customer_id is distinct from old.customer_id or
 new.source_app is distinct from old.source_app or new.created_at is distinct from old.created_at then
 raise exception 'Memory identity and scope are immutable';end if;
 if new.revision<>old.revision+1 then raise exception 'Memory revision must advance once';end if;
 new.updated_at=now();return new;
end;$$;
revoke all on function public.veltra_memory_version() from public,anon,authenticated;
create trigger veltra_memory_version before update on public.veltra_memories for each row execute function public.veltra_memory_version();
commit;
