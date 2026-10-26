-- Run after revenue-bootstrap.sql and the revenue migrations, on an isolated database.
-- Dedicated Google Calendar connections: rows are visible only to the user who connected them,
-- secrets are not readable, the link token works only for its own connection and only while
-- its owner is still an owner or member, and nothing can be written directly.
\set ON_ERROR_STOP 1
begin;
insert into auth.users(id) values ('a2000000-0000-4000-8000-000000000001'),('a2000000-0000-4000-8000-000000000002'),('a2000000-0000-4000-8000-000000000003'),('a2000000-0000-4000-8000-000000000004');
insert into public.crm_workspaces(id,name,owner_id) values
 ('b2000000-0000-4000-8000-000000000001','Calendar A','a2000000-0000-4000-8000-000000000001'),
 ('b2000000-0000-4000-8000-000000000002','Calendar B','a2000000-0000-4000-8000-000000000004');
insert into public.crm_memberships values
 ('b2000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','owner',now()),
 ('b2000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000002','member',now()),
 ('b2000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000003','viewer',now()),
 ('b2000000-0000-4000-8000-000000000002','a2000000-0000-4000-8000-000000000004','owner',now());

-- The member connects (begin with their session, activate with the pending token as Mail would).
set local role authenticated;
set local request.jwt.claim.sub='a2000000-0000-4000-8000-000000000002';
create temp table cal_link on commit drop as
 select (public.revenue_calendar_begin('b2000000-0000-4000-8000-000000000001',encode(sha256(convert_to(repeat('m',48),'UTF8')),'hex'))->>'connection_id')::uuid id;
grant select on cal_link to anon, authenticated;
reset role;

set local role anon;
do $$ declare c uuid := (select id from cal_link); begin
 begin perform public.revenue_calendar_activate(c,repeat('x',48),'{"email":"m@x.example","subject":"s"}'); raise exception 'wrong pending token activated';
 exception when insufficient_privilege then null; end;
 perform public.revenue_calendar_activate(c,repeat('m',48),jsonb_build_object('email','Member@Studio.Example','subject','member-sub',
  'scopes',jsonb_build_array('openid','https://www.googleapis.com/auth/calendar.events')));
 begin perform public.revenue_calendar_activate(c,repeat('m',48),'{"email":"m@x.example","subject":"s"}'); raise exception 'pending token reused';
 exception when insufficient_privilege then null; end;
 perform public.revenue_calendar_report_calendars(c,repeat('m',48),'[{"calendar_id":"primary","summary":"Member","time_zone":"America/New_York","access_role":"owner","primary":true}]');
 if (public.revenue_calendar_state(c,repeat('m',48))->'connection'->>'google_email')<>'member@studio.example' then raise exception 'google email not normalized'; end if;
 -- Anon cannot read the tables or use the session RPCs.
 begin perform 1 from public.revenue_calendar_connections; raise exception 'anon read calendar connections';
 exception when insufficient_privilege then null; end;
 begin perform public.revenue_calendar_connections('b2000000-0000-4000-8000-000000000001'); raise exception 'anon listed calendar connections';
 exception when insufficient_privilege then null; end;
 begin perform revenue_private.calendar_connection(c,repeat('m',48)); raise exception 'anon reached a private calendar function';
 exception when insufficient_privilege then null; end;
end $$;
reset role;

set local role authenticated;
do $$ declare c uuid := (select id from cal_link); begin
 -- The member sees their own connection, but never the link token, pending token or sync position.
 perform set_config('request.jwt.claim.sub','a2000000-0000-4000-8000-000000000002',true);
 if (select count(*) from public.revenue_calendar_connections)<>1 then raise exception 'member cannot see their own connection'; end if;
 if (select count(*) from public.revenue_calendar_calendars)<>1 then raise exception 'member cannot see their own calendars'; end if;
 begin perform token_hash from public.revenue_calendar_connections; raise exception 'token hash readable';
 exception when insufficient_privilege then null; end;
 begin perform pending_hash from public.revenue_calendar_connections; raise exception 'pending hash readable';
 exception when insufficient_privilege then null; end;
 begin perform sync_token from public.revenue_calendar_calendars; raise exception 'sync token readable';
 exception when insufficient_privilege then null; end;
 begin update public.revenue_calendar_connections set status='healthy'; raise exception 'direct update allowed';
 exception when insufficient_privilege then null; end;
 begin insert into public.revenue_calendar_calendars(connection_id,calendar_id,workspace_id,user_id) values (c,'x','b2000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000002'); raise exception 'direct insert allowed';
 exception when insufficient_privilege then null; end;

 -- The workspace owner and the viewer see nothing of the member's calendar and cannot change it.
 perform set_config('request.jwt.claim.sub','a2000000-0000-4000-8000-000000000001',true);
 if (select count(*) from public.revenue_calendar_connections)<>0 or (select count(*) from public.revenue_calendar_calendars)<>0 then raise exception 'owner sees a member calendar'; end if;
 if public.revenue_calendar_connections('b2000000-0000-4000-8000-000000000001')<>'[]'::jsonb then raise exception 'owner listed a member calendar'; end if;
 begin perform public.revenue_calendar_select('b2000000-0000-4000-8000-000000000001','primary',false,null); raise exception 'owner changed a member calendar';
 exception when others then if sqlerrm not like '404:%' then raise; end if; end;
 if (public.revenue_calendar_disconnect('b2000000-0000-4000-8000-000000000001')->>'disconnected')::boolean then raise exception 'owner disconnected a member calendar'; end if;
 perform set_config('request.jwt.claim.sub','a2000000-0000-4000-8000-000000000003',true);
 if (select count(*) from public.revenue_calendar_connections)<>0 then raise exception 'viewer sees a member calendar'; end if;
 begin perform public.revenue_calendar_begin('b2000000-0000-4000-8000-000000000001',repeat('a',64)); raise exception 'viewer connected a calendar';
 exception when others then if sqlerrm not like '403:%' then raise; end if; end;

 -- Another workspace's owner sees nothing and cannot connect here.
 perform set_config('request.jwt.claim.sub','a2000000-0000-4000-8000-000000000004',true);
 if (select count(*) from public.revenue_calendar_connections)<>0 then raise exception 'other workspace sees a calendar'; end if;
 begin perform public.revenue_calendar_begin('b2000000-0000-4000-8000-000000000001',repeat('a',64)); raise exception 'outsider connected a calendar';
 exception when others then if sqlerrm not like '404:%' then raise; end if; end;
 begin perform public.revenue_calendar_connections('b2000000-0000-4000-8000-000000000001'); raise exception 'outsider listed calendars';
 exception when others then if sqlerrm not like '404:%' then raise; end if; end;
end $$;
reset role;

-- The link token stops working when its owner is demoted to viewer, and after disconnect.
update public.crm_memberships set role='viewer' where workspace_id='b2000000-0000-4000-8000-000000000001' and user_id='a2000000-0000-4000-8000-000000000002';
set local role anon;
do $$ declare c uuid := (select id from cal_link); begin
 begin perform public.revenue_calendar_state(c,repeat('m',48)); raise exception 'demoted owner link token still works';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
update public.crm_memberships set role='member' where workspace_id='b2000000-0000-4000-8000-000000000001' and user_id='a2000000-0000-4000-8000-000000000002';
set local role authenticated;
set local request.jwt.claim.sub='a2000000-0000-4000-8000-000000000002';
do $$ begin
 if not (public.revenue_calendar_disconnect('b2000000-0000-4000-8000-000000000001')->>'disconnected')::boolean then raise exception 'disconnect failed'; end if;
end $$;
reset role;
set local role anon;
do $$ declare c uuid := (select id from cal_link); begin
 begin perform public.revenue_calendar_state(c,repeat('m',48)); raise exception 'link token works after disconnect';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
 if exists(select 1 from public.revenue_calendar_calendars where connection_id=(select id from cal_link)) then raise exception 'calendar list kept after disconnect'; end if;
end $$;
rollback;
\echo 'revenue calendar tests passed'
