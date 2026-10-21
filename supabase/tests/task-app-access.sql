begin;
-- Seed only an otherwise empty auth fixture; the entire transaction is rolled back.
insert into auth.users(id,aud,role,email,created_at,updated_at) select 'f0000000-0000-4000-8000-000000000098','authenticated','authenticated','task-access-test@example.invalid',now(),now() where not exists(select 1 from auth.users);
select set_config('request.jwt.claims',json_build_object('sub',(select id from auth.users limit 1),'role','authenticated','is_anonymous',false)::text,true);
set local role authenticated;
select public.veltra_task_access('start','f0000000-0000-4000-8000-000000000001','Task access verification (rolled back)');
select public.veltra_task_access('decide','f0000000-0000-4000-8000-000000000001',null,'mail',false);
select public.veltra_task_access('decide','f0000000-0000-4000-8000-000000000001',null,'mail',true);
do $$ begin
 if (select allowed from public.veltra_ai_task_access where task_id='f0000000-0000-4000-8000-000000000001' and app='mail') then raise exception 'Deny was overwritten';end if;
 begin
  insert into public.veltra_ai_tasks(id,user_id,purpose) values('f0000000-0000-4000-8000-000000000002',auth.uid(),'Bypass check');
  raise exception 'Direct table writes must be denied';
 exception when insufficient_privilege then null;end;
end $$;
select public.veltra_task_access('finish','f0000000-0000-4000-8000-000000000001');
do $$ begin
 if not exists(select 1 from public.veltra_ai_tasks where id='f0000000-0000-4000-8000-000000000001' and completed_at is not null) then raise exception 'Task did not end';end if;
 begin
  perform public.veltra_task_access('decide','f0000000-0000-4000-8000-000000000001',null,'github',true);
  raise exception 'Completed task accepted access';
 exception when raise_exception then if sqlerrm!='Task access has ended' then raise;end if;end;
end $$;
select set_config('request.jwt.claims','{"sub":"f0000000-0000-4000-8000-000000000099","role":"authenticated","is_anonymous":false}',true);
do $$ begin
 if exists(select 1 from public.veltra_ai_tasks where id='f0000000-0000-4000-8000-000000000001') then raise exception 'Cross-user task read';end if;
 if exists(select 1 from public.veltra_ai_task_access where task_id='f0000000-0000-4000-8000-000000000001') then raise exception 'Cross-user grant read';end if;
end $$;
set local role anon;
do $$ begin
 begin
  perform public.veltra_task_access('finish','f0000000-0000-4000-8000-000000000001');
  raise exception 'Anonymous RPC access';
 exception when insufficient_privilege then null;end;
end $$;
rollback;
