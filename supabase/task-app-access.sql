-- Task access is separate from connected accounts and background automation.
create table if not exists public.veltra_ai_tasks (
 id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
 purpose text not null check(length(purpose) between 1 and 1000),
 created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '1 hour',
 completed_at timestamptz, unique(id,user_id),check(expires_at<=created_at+interval '1 hour')
);
create table if not exists public.veltra_ai_task_access (
 task_id uuid not null, user_id uuid not null, app text not null check(app in ('mail','crm','brain','github','vercel','supabase','railway','n8n','bee','browser','connections','shopify','tms')),
 allowed boolean not null, decided_at timestamptz not null default now(), primary key(task_id,app),
 foreign key(task_id,user_id) references public.veltra_ai_tasks(id,user_id) on delete cascade
);
create index if not exists veltra_ai_tasks_owner on public.veltra_ai_tasks(user_id,id);
create index if not exists veltra_ai_task_access_owner on public.veltra_ai_task_access(user_id,task_id);
alter table public.veltra_ai_tasks enable row level security;
alter table public.veltra_ai_task_access enable row level security;
revoke all on public.veltra_ai_tasks,public.veltra_ai_task_access from public,anon,authenticated;
grant select on public.veltra_ai_tasks,public.veltra_ai_task_access to authenticated;
drop policy if exists ai_tasks_owner on public.veltra_ai_tasks;
create policy ai_tasks_owner on public.veltra_ai_tasks for select to authenticated using ((select auth.uid())=user_id);
drop policy if exists ai_task_access_owner on public.veltra_ai_task_access;
create policy ai_task_access_owner on public.veltra_ai_task_access for select to authenticated using ((select auth.uid())=user_id);
create or replace function public.veltra_task_access(p_action text,p_task uuid,p_purpose text default null,p_app text default null,p_allowed boolean default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare owner_id uuid:=auth.uid(); t public.veltra_ai_tasks; decision boolean;
begin
 if owner_id is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'Sign in required'; end if;
 if p_action='start' then
  if p_purpose is null or length(trim(p_purpose)) not between 1 and 1000 then raise exception 'Task purpose required'; end if;
  insert into public.veltra_ai_tasks(id,user_id,purpose) values(p_task,owner_id,trim(p_purpose)) on conflict(id) do nothing;
 end if;
 select * into t from public.veltra_ai_tasks where id=p_task and user_id=owner_id for update;
 if not found then raise exception 'Task not found'; end if;
 if p_action='finish' then
  update public.veltra_ai_tasks set completed_at=coalesce(completed_at,now()) where id=p_task and user_id=owner_id;
  return jsonb_build_object('completed',true);
 end if;
 if t.completed_at is not null or t.expires_at<=now() then raise exception 'Task access has ended'; end if;
 if p_action='start' then return jsonb_build_object('task_id',t.id,'expires_at',t.expires_at); end if;
 if p_action!='decide' or p_allowed is null or p_app is null or p_app not in ('mail','crm','brain','github','vercel','supabase','railway','n8n','bee','browser','connections','shopify','tms') then raise exception 'Invalid access decision'; end if;
 insert into public.veltra_ai_task_access(task_id,user_id,app,allowed) values(p_task,owner_id,p_app,p_allowed) on conflict(task_id,app) do nothing;
 select allowed into decision from public.veltra_ai_task_access where task_id=p_task and user_id=owner_id and app=p_app;
 return jsonb_build_object('app',p_app,'allowed',decision,'task_id',p_task,'expires_at',t.expires_at);
end $$;
revoke all on function public.veltra_task_access(text,uuid,text,text,boolean) from public,anon;
grant execute on function public.veltra_task_access(text,uuid,text,text,boolean) to authenticated;
