begin;
create table public.workspace_team_responsibilities(
 workspace_id uuid not null references public.crm_workspaces(id) on delete cascade,
 task_key text not null, owner text not null check(owner in ('onyx','onixa','onixelia')),
 task_group text not null check(task_group in ('Operate','Repair','Improve','Build')),
 title text not null, check_description text not null, completion_evidence text not null,
 tool text not null, execution text not null check(execution in ('reviewed_tools','existing_worker','not_implemented')),
 assigned_by uuid not null, assigned_at timestamptz not null default now(),
 primary key(workspace_id,task_key)
);
alter table public.workspace_team_responsibilities enable row level security;
revoke all on public.workspace_team_responsibilities from public,anon,authenticated;
grant select on public.workspace_team_responsibilities to authenticated;
create policy responsibility_members on public.workspace_team_responsibilities for select to authenticated using(exists(select 1 from public.crm_memberships m where m.workspace_id=workspace_team_responsibilities.workspace_id and m.user_id=(select auth.uid())));
create function public.workspace_team_assign_responsibilities(p_workspace uuid,p_tasks jsonb) returns integer language plpgsql security definer set search_path='' as $$
declare t jsonb;
begin
 if auth.uid() is null or not exists(select 1 from public.crm_memberships where workspace_id=p_workspace and user_id=auth.uid() and role='owner') then raise exception 'Business owner required';end if;
 if p_tasks is null or jsonb_typeof(p_tasks)<>'array' or jsonb_array_length(p_tasks) not between 1 and 20 then raise exception 'Invalid task set';end if;
 for t in select value from jsonb_array_elements(p_tasks) loop
 if (t->>'key') is null or (t->>'key')!~'^[a-z_]{1,60}$' or length(coalesce(t->>'title','')) not between 1 and 200 or length(coalesce(t->>'check','')) not between 1 and 1000 or length(coalesce(t->>'done','')) not between 1 and 1000 then raise exception 'Invalid responsibility';end if;
 insert into public.workspace_team_responsibilities(workspace_id,task_key,owner,task_group,title,check_description,completion_evidence,tool,execution,assigned_by)
 values(p_workspace,t->>'key',t->>'owner',t->>'group',t->>'title',t->>'check',t->>'done',t->>'tool',t->>'execution',auth.uid()) on conflict(workspace_id,task_key) do nothing;
 end loop;
 return (select count(*)::integer from public.workspace_team_responsibilities where workspace_id=p_workspace);
end $$;
revoke all on function public.workspace_team_assign_responsibilities(uuid,jsonb) from public,anon;
grant execute on function public.workspace_team_assign_responsibilities(uuid,jsonb) to authenticated;
commit;
