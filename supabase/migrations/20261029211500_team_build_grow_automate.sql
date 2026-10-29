begin;
alter table public.workspace_team_responsibilities drop constraint workspace_team_responsibilities_task_group_check;
-- Convert only the initial standard duties; preserve custom responsibility ownership.
update public.workspace_team_responsibilities set owner=case
 when task_key in ('recovery','verification','improvement','build','playbook') then 'onyx'
 when task_key in ('customer_replies','follow_ups','content','records','campaigns','community') then 'onixa'
 when task_key in ('daily_priorities','delivery','financial_health','daily_recap') then 'onixelia'
 else owner end;
update public.workspace_team_responsibilities set task_group=case owner when 'onyx' then 'Build' when 'onixa' then 'Grow' else 'Automate' end;
alter table public.workspace_team_responsibilities add constraint workspace_team_responsibilities_task_group_check check(task_group in ('Build','Grow','Automate'));
alter table public.workspace_team_responsibilities add constraint team_role_lane check((owner='onyx' and task_group='Build') or (owner='onixa' and task_group='Grow') or (owner='onixelia' and task_group='Automate'));
commit;
