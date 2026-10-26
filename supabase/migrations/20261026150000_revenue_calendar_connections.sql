-- Onixus revenue system: dedicated Google Calendar connections for Onixus Workspace users.
--
-- Google tokens never reach this database. Onixus Mail holds each user's Calendar grant sealed in
-- its connection store (provider google_calendar, separate from the Gmail sign-in and the Drive
-- grant) and authenticates here with a per-connection link token, the same pattern as
-- crm_mail_connections. Only the token's sha256 is stored.
--
--  * revenue_calendar_connections: one row per (workspace, user). Readable only by that user.
--  * revenue_calendar_calendars: the user's Google calendars, which ones sync into the CRM, and
--    the default calendar for new events. Sync positions are never readable by users.
--  * Meetings from both paths (this one and the Mail mailbox relay) go through
--    revenue_private.ingest_calendar -> save_meeting, keyed by (workspace, provider, event id) and
--    ordered by Google's updated time, so resyncs, reschedules and the two paths converge on one
--    meeting and one set of timeline events. When a dedicated connection exists for a mailbox's
--    Google account, the mailbox relay stops recording that account's events.
--  * Meetings now keep the event time zone, all-day dates and recurring series id; summaries on
--    the timeline show the event's own time zone. Times are stored in UTC (timestamptz).
--
-- Additive: new tables, nullable columns on revenue_meetings (metadata-only), replaced functions.
begin;

create table if not exists public.revenue_calendar_connections(
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.crm_workspaces(id),
 user_id uuid not null references auth.users(id),
 provider text not null default 'google_calendar' check(provider in ('google_calendar')),
 google_email text check(google_email is null or length(google_email)<=320),
 google_subject text check(google_subject is null or length(google_subject)<=255),
 scopes text[] not null default '{}',
 token_hash text unique check(token_hash is null or token_hash ~ '^[a-f0-9]{64}$'),
 pending_hash text unique check(pending_hash is null or pending_hash ~ '^[a-f0-9]{64}$'),
 pending_at timestamptz,
 status text not null default 'pending' check(status in ('pending','healthy','expired','revoked','scope_missing','api_disabled','error','disconnected')),
 last_error text check(last_error is null or length(last_error)<=500),
 last_synced_at timestamptz,
 last_attempt_at timestamptz,
 consecutive_failures integer not null default 0,
 next_attempt_at timestamptz,
 share_meetings boolean not null default true,
 user_timezone text check(user_timezone is null or length(user_timezone)<=64),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(workspace_id,user_id,provider)
);
create index if not exists revenue_calendar_connections_user on public.revenue_calendar_connections(user_id);

create table if not exists public.revenue_calendar_calendars(
 connection_id uuid not null references public.revenue_calendar_connections(id) on delete cascade,
 calendar_id text not null check(length(calendar_id) between 1 and 300),
 workspace_id uuid not null references public.crm_workspaces(id),
 user_id uuid not null references auth.users(id),
 summary text check(summary is null or length(summary)<=300),
 time_zone text check(time_zone is null or length(time_zone)<=64),
 access_role text check(access_role is null or access_role in ('owner','writer','reader','freeBusyReader')),
 is_primary boolean not null default false,
 available boolean not null default true,
 sync_enabled boolean not null default false,
 write_default boolean not null default false,
 sync_token text check(sync_token is null or length(sync_token)<=2000),
 page_token text check(page_token is null or length(page_token)<=2000),
 status text not null default 'unknown' check(status in ('unknown','healthy','error')),
 last_synced_at timestamptz,
 last_error text check(last_error is null or length(last_error)<=500),
 events_synced bigint not null default 0,
 updated_at timestamptz not null default now(),
 primary key(connection_id,calendar_id)
);
create unique index if not exists revenue_calendar_one_write_default on public.revenue_calendar_calendars(connection_id) where write_default;

alter table public.revenue_meetings
 add column if not exists calendar_connection_id uuid,
 add column if not exists calendar_id text,
 add column if not exists time_zone text,
 add column if not exists all_day boolean,
 add column if not exists start_date date,
 add column if not exists end_date date,
 add column if not exists recurring_event_id text,
 add column if not exists ical_uid text;
create index if not exists revenue_meetings_series on public.revenue_meetings(workspace_id,recurring_event_id) where recurring_event_id is not null;

-- ---------- helpers ----------
create or replace function revenue_private.valid_tz(p text) returns text
language plpgsql stable set search_path='' as $$
begin
 if p is null or length(p)>64 or p !~ '^[A-Za-z][A-Za-z0-9_+/-]*$' then return null; end if;
 perform now() at time zone p;
 return p;
exception when others then return null;
end $$;

-- "2026-03-08 09:30 America/New_York", "2026-03-08 (all day)", or the UTC form used before.
create or replace function revenue_private.meeting_when(p_starts timestamptz, p_tz text, p_all_day boolean, p_date date) returns text
language sql stable set search_path='' as $$
 select case
  when coalesce(p_all_day,false) and p_date is not null then to_char(p_date,'YYYY-MM-DD')||' (all day)'
  when revenue_private.valid_tz(p_tz) is not null then to_char(p_starts at time zone p_tz,'YYYY-MM-DD HH24:MI')||' '||p_tz
  else to_char(p_starts at time zone 'UTC','YYYY-MM-DD HH24:MI')||' UTC' end
$$;

create or replace function revenue_private.token_digest(p text) returns text
language sql immutable set search_path='' as $$ select encode(sha256(convert_to(coalesce(p,''),'UTF8')),'hex') $$;

-- Mail's per-connection link token. The owner must still be a member of the workspace.
create or replace function revenue_private.calendar_connection(p_connection uuid, p_token text) returns public.revenue_calendar_connections
language plpgsql stable security definer set search_path='' as $$
declare c public.revenue_calendar_connections;
begin
 select * into c from public.revenue_calendar_connections where id=p_connection;
 if c.id is null or c.token_hash is null or p_token is null or length(p_token)<32 or c.token_hash<>revenue_private.token_digest(p_token) then
  raise exception '403:This calendar connection was revoked or replaced. Reconnect Google Calendar in Onixus Workspace.' using errcode='42501';
 end if;
 if not exists(select 1 from public.crm_memberships where workspace_id=c.workspace_id and user_id=c.user_id and role in ('owner','member')) then
  raise exception '403:The calendar owner can no longer add meetings to this workspace.' using errcode='42501';
 end if;
 return c;
end $$;

create or replace function revenue_private.own_calendar(p_workspace uuid) returns public.revenue_calendar_connections
language plpgsql stable security definer set search_path='' as $$
declare u uuid := revenue_private.require_role(p_workspace,'viewer'); c public.revenue_calendar_connections;
begin
 select * into c from public.revenue_calendar_connections where workspace_id=p_workspace and user_id=u and provider='google_calendar';
 if c.id is null then raise exception '404:Connect Google Calendar first.'; end if;
 return c;
end $$;

-- ---------- meetings (shared by every calendar path) ----------
-- Same contract as before, plus: optional time zone / all-day / series columns read from
-- p_detail, summaries in the event's time zone, and a meeting.updated event when only the title
-- changes. Dedupe keys are unchanged, so meetings recorded before this migration keep converging.
create or replace function revenue_private.save_meeting(p_workspace uuid, p_customer uuid, p_deal uuid, p_auto_deal boolean, p_title text, p_starts timestamptz, p_ends timestamptz,
 p_status text, p_provider text, p_event_id text, p_updated timestamptz, p_actor text, p_detail jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.revenue_meetings; prev public.revenue_meetings; d uuid := p_deal; ids uuid[]; src text := case when p_provider='manual' then 'crm' else 'calendar' end;
 stamp text := coalesce(to_char(p_updated at time zone 'UTC','YYYYMMDD"T"HH24MISS.US'),'manual');
 x jsonb := coalesce(p_detail,'{}'); tz text; allday boolean; sd date; ed date;
begin
 select * into prev from public.revenue_meetings where workspace_id=p_workspace and provider=p_provider and provider_event_id=p_event_id for update;
 if prev.id is not null and p_updated is not null and prev.provider_updated_at is not null and p_updated<=prev.provider_updated_at then
  return jsonb_build_object('meeting_id',prev.id,'deal_id',prev.deal_id,'status',prev.status,'ignored','stale_update');
 end if;
 if prev.id is null and d is null and coalesce(p_auto_deal,false) then
  select array_agg(id) into ids from public.crm_deals where workspace_id=p_workspace and customer_id=p_customer and revenue_private.stage_outcome(p_workspace,stage)='open';
  if coalesce(array_length(ids,1),0)=1 then d := ids[1]; end if;
 end if;
 tz := coalesce(revenue_private.valid_tz(x->>'time_zone'),prev.time_zone);
 allday := coalesce((x->>'all_day')::boolean,prev.all_day);
 sd := case when allday then coalesce((x->>'start_date')::date,prev.start_date) end;
 ed := case when allday then coalesce((x->>'end_date')::date,prev.end_date) end;
 insert into public.revenue_meetings(workspace_id,customer_id,deal_id,title,starts_at,ends_at,status,provider,provider_event_id,provider_updated_at,created_by,
   calendar_connection_id,calendar_id,time_zone,all_day,start_date,end_date,recurring_event_id,ical_uid)
 values(p_workspace,p_customer,d,left(p_title,300),p_starts,p_ends,coalesce(p_status,'scheduled'),p_provider,p_event_id,p_updated,auth.uid(),
   nullif(x->>'connection_id','')::uuid,left(nullif(x->>'calendar_id',''),300),tz,allday,sd,ed,left(nullif(x->>'recurring_event_id',''),1024),left(nullif(x->>'ical_uid',''),1024))
 on conflict(workspace_id,provider,provider_event_id) do update set title=excluded.title,starts_at=excluded.starts_at,ends_at=excluded.ends_at,status=excluded.status,
  provider_updated_at=excluded.provider_updated_at,deal_id=coalesce(public.revenue_meetings.deal_id,excluded.deal_id),
  calendar_connection_id=coalesce(public.revenue_meetings.calendar_connection_id,excluded.calendar_connection_id),
  calendar_id=coalesce(public.revenue_meetings.calendar_id,excluded.calendar_id),
  time_zone=excluded.time_zone,all_day=excluded.all_day,start_date=excluded.start_date,end_date=excluded.end_date,
  recurring_event_id=coalesce(excluded.recurring_event_id,public.revenue_meetings.recurring_event_id),ical_uid=coalesce(excluded.ical_uid,public.revenue_meetings.ical_uid)
 returning * into m;
 if prev.id is null or prev.status is distinct from m.status then
  perform revenue_private.record_event(p_workspace,m.customer_id,m.deal_id,'meeting.'||m.status,src,p_actor,null,now(),m.status,'meeting',m.id,
   case m.status when 'scheduled' then case when prev.id is null then 'Meeting booked: ' else 'Meeting restored: ' end when 'cancelled' then 'Meeting cancelled: ' else 'Meeting '||m.status||': ' end
    ||m.title||' ('||revenue_private.meeting_when(m.starts_at,m.time_zone,m.all_day,m.start_date)||')',
   jsonb_build_object('starts_at',m.starts_at,'ends_at',m.ends_at,'provider',p_provider,'time_zone',m.time_zone,'all_day',coalesce(m.all_day,false))||(x-'connection_id'-'calendar_id'),
   jsonb_build_object('deal_id',m.deal_id),
   'meeting.'||m.status||':'||m.id||case when prev.id is null then '' else ':'||stamp end);
 elsif prev.starts_at is distinct from m.starts_at or prev.ends_at is distinct from m.ends_at then
  perform revenue_private.record_event(p_workspace,m.customer_id,m.deal_id,'meeting.rescheduled',src,p_actor,null,now(),m.status,'meeting',m.id,
   'Meeting moved: '||m.title||' (now '||revenue_private.meeting_when(m.starts_at,m.time_zone,m.all_day,m.start_date)||', was '||revenue_private.meeting_when(prev.starts_at,coalesce(prev.time_zone,m.time_zone),prev.all_day,prev.start_date)||')',
   jsonb_build_object('starts_at',m.starts_at,'ends_at',m.ends_at,'previous_starts_at',prev.starts_at,'provider',p_provider,'time_zone',m.time_zone,'all_day',coalesce(m.all_day,false))||(x-'connection_id'-'calendar_id'),
   jsonb_build_object('deal_id',m.deal_id),
   'meeting.rescheduled:'||m.id||':'||stamp);
 elsif prev.title is distinct from m.title then
  perform revenue_private.record_event(p_workspace,m.customer_id,m.deal_id,'meeting.updated',src,p_actor,null,now(),m.status,'meeting',m.id,
   'Meeting renamed: '||m.title||' ('||revenue_private.meeting_when(m.starts_at,m.time_zone,m.all_day,m.start_date)||')',
   jsonb_build_object('starts_at',m.starts_at,'provider',p_provider,'previous_title',prev.title)||(x-'connection_id'-'calendar_id'),
   jsonb_build_object('deal_id',m.deal_id),
   'meeting.updated:'||m.id||':'||stamp);
 end if;
 return jsonb_build_object('meeting_id',m.id,'deal_id',m.deal_id,'status',m.status,'created',prev.id is null);
end $$;

-- Calendar event -> meeting. Unchanged rules for who counts as a customer and which organizers
-- are trusted; new: all-day events (start_date/end_date in the calendar's time zone), the event
-- time zone, the recurring series id and the source calendar/connection are kept.
create or replace function revenue_private.ingest_calendar(p_workspace uuid, p_provider text, p_source text, p_event jsonb, p_internal text[], p_trusted boolean, p_create_unknown boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare eid text := nullif(p_event->>'provider_event_id',''); upd timestamptz; starts timestamptz; ends timestamptz; st text;
 existing public.revenue_meetings; internal text[]; a jsonb; em text; r jsonb; last_r jsonb; review jsonb; matched uuid[] := '{}'; matched_emails text[] := '{}';
 org text := public.revenue_normalize_email(p_event->>'organizer_email'); trusted boolean := coalesce(p_trusted,false); first_unknown jsonb; chosen uuid;
 title text := left(coalesce(nullif(trim(p_event->>'title'),''),'Meeting'),300); detail jsonb;
 tz text := revenue_private.valid_tz(p_event->>'time_zone'); allday boolean := coalesce((p_event->>'all_day')::boolean,false); sd date; ed date;
begin
 if eid is null or length(eid)>1024 then raise exception '400:Calendar event id required.'; end if;
 begin
  upd := (p_event->>'updated_at')::timestamptz;
  if allday then
   sd := (p_event->>'start_date')::date; ed := (p_event->>'end_date')::date;
   if sd is not null then starts := sd::timestamp at time zone coalesce(tz,'UTC'); end if;
   if ed is not null then ends := ed::timestamp at time zone coalesce(tz,'UTC'); end if;
  else
   starts := (p_event->>'starts_at')::timestamptz; ends := (p_event->>'ends_at')::timestamptz;
  end if;
 exception when others then raise exception '400:Calendar event times are invalid.';
 end;
 if upd is null then raise exception '400:Calendar event update time required.'; end if;
 if upd>now()+interval '10 minutes' then raise exception '400:Event time is in the future.'; end if;
 st := case when p_event->>'status'='cancelled' then 'cancelled' else 'scheduled' end;
 detail := jsonb_build_object('untrusted_content',true,'source',p_source);
 if tz is not null then detail := detail||jsonb_build_object('time_zone',tz); end if;
 if allday then detail := detail||jsonb_build_object('all_day',true,'start_date',sd,'end_date',ed);
 elsif p_event ? 'all_day' then detail := detail||jsonb_build_object('all_day',false); end if;
 detail := detail||jsonb_strip_nulls(jsonb_build_object('recurring_event_id',nullif(p_event->>'recurring_event_id',''),'ical_uid',nullif(p_event->>'ical_uid',''),
  'calendar_id',nullif(p_event->>'calendar_id',''),'connection_id',nullif(p_event->>'connection_id','')));
 perform pg_advisory_xact_lock(hashtextextended('revenue-calendar:'||p_workspace||':'||p_provider||':'||eid,0));
 select * into existing from public.revenue_meetings where workspace_id=p_workspace and provider=p_provider and provider_event_id=eid;
 if existing.id is not null then
  -- Cancellations in incremental sync may carry only the id; keep the stored times and title.
  if st='cancelled' and starts is null then detail := detail-'all_day'-'start_date'-'end_date'; end if;
  return revenue_private.save_meeting(p_workspace,existing.customer_id,existing.deal_id,false,case when nullif(trim(p_event->>'title'),'') is null then existing.title else title end,
   coalesce(starts,existing.starts_at),coalesce(ends,existing.ends_at),st,p_provider,eid,upd,'provider',detail);
 end if;
 if st='cancelled' then return jsonb_build_object('ignored','cancelled_before_seen'); end if;
 if starts is null or ends is null or ends<=starts then raise exception '400:Calendar event needs a start and an end time.'; end if;
 internal := array(select public.revenue_normalize_email(x) from unnest(coalesce(p_internal,'{}'::text[])) x where public.revenue_normalize_email(x) is not null)
  || array(select public.revenue_normalize_email(email) from public.revenue_sender_identities where workspace_id=p_workspace)
  || array(select public.revenue_normalize_email(u.email) from auth.users u join public.crm_memberships ms on ms.user_id=u.id where ms.workspace_id=p_workspace and u.email is not null)
  || array(select public.revenue_normalize_email(mailbox) from public.revenue_sync_state where workspace_id=p_workspace and mailbox is not null)
  || array(select public.revenue_normalize_email(google_email) from public.revenue_calendar_connections where workspace_id=p_workspace and google_email is not null);
 if coalesce((p_event->>'organizer_self')::boolean,false) or org=any(internal) then trusted := true; end if;
 for a in select value from jsonb_array_elements(case when jsonb_typeof(p_event->'attendees')='array' then p_event->'attendees' else '[]'::jsonb end) with ordinality x(value,n) order by n limit 100 loop
  em := public.revenue_normalize_email(a->>'email');
  continue when em is null or coalesce((a->>'self')::boolean,false) or coalesce((a->>'resource')::boolean,false) or em=any(internal) or em like '%calendar.google.com';
  if not exists(select 1 from public.crm_customers where workspace_id=p_workspace and merged_into_id is null and email is not null and public.revenue_normalize_email(email)=em) then
   first_unknown := coalesce(first_unknown,a);
   continue;
  end if;
  r := revenue_private.resolve_identity(p_workspace,a->>'email',null,a->>'name',null,p_source,jsonb_build_object('calendar_event',eid));
  last_r := coalesce(last_r,r);
  if r->>'outcome'='review' then review := coalesce(review,r); end if;
  if not ((r->>'customer_id')::uuid=any(matched)) then matched := matched||(r->>'customer_id')::uuid; end if;
  matched_emails := matched_emails||em;
 end loop;
 if cardinality(matched)=0 then
  if not (coalesce(p_create_unknown,false) and first_unknown is not null) then
   return jsonb_build_object('ignored',case when first_unknown is null then 'no_external_attendees' else 'no_known_attendee' end);
  end if;
  r := revenue_private.resolve_identity(p_workspace,first_unknown->>'email',null,first_unknown->>'name',null,p_source,jsonb_build_object('calendar_event',eid));
  last_r := r;
  if r->>'outcome'='review' then review := r; end if;
  matched := array[(r->>'customer_id')::uuid];
  matched_emails := array[public.revenue_normalize_email(first_unknown->>'email')];
 end if;
 if not trusted and not (org=any(matched_emails)) then return jsonb_build_object('ignored','organizer_not_trusted'); end if;
 chosen := coalesce((review->>'customer_id')::uuid,matched[1]);
 if review is not null then detail := detail||jsonb_build_object('identity_review_id',review->>'review_id'); end if;
 if cardinality(matched)>1 then detail := detail||jsonb_build_object('other_customers',to_jsonb(matched[2:])); end if;
 return revenue_private.save_meeting(p_workspace,chosen,null,review is null,title,starts,ends,st,p_provider,eid,upd,'provider',detail)
  ||jsonb_build_object('customer_id',chosen,'identity',coalesce(review,last_r),'matched_customers',cardinality(matched));
end $$;

-- Mailbox relay path: unchanged, except that a Google account with a dedicated Workspace calendar
-- connection in this workspace is recorded only through that connection (one source of truth).
create or replace function public.revenue_mail_calendar_event(p_account uuid, p_token text, p_event jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare w uuid := crm_private.mail_workspace(p_account,p_token); mb text := public.revenue_normalize_email(p_event->>'mailbox');
begin
 if mb is not null and exists(select 1 from public.revenue_calendar_connections where workspace_id=w and status<>'disconnected' and token_hash is not null
    and public.revenue_normalize_email(google_email)=mb) then
  return jsonb_build_object('ignored','dedicated_calendar_connection');
 end if;
 return revenue_private.ingest_calendar(w,'google_calendar','Google Calendar',p_event,array[p_event->>'mailbox'],false,false);
end $$;

-- ---------- user RPCs (Onixus Workspace session) ----------
-- Called by Onixus Mail with the user's own session when they start connecting. The pending
-- token becomes active only after Google returns to Mail (revenue_calendar_activate), so a
-- cancelled reconnect leaves the existing connection working.
create or replace function public.revenue_calendar_begin(p_workspace uuid, p_pending_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid := revenue_private.require_role(p_workspace,'member'); c public.revenue_calendar_connections;
begin
 if p_pending_hash is null or p_pending_hash !~ '^[a-f0-9]{64}$' then raise exception '400:Invalid connection request.'; end if;
 insert into public.revenue_calendar_connections(workspace_id,user_id,pending_hash,pending_at)
 values(p_workspace,u,p_pending_hash,now())
 on conflict(workspace_id,user_id,provider) do update set pending_hash=excluded.pending_hash,pending_at=now(),updated_at=now()
 returning * into c;
 perform revenue_private.audit(p_workspace,'user','calendar.connect_started','calendar_connection',c.id::text,'{}');
 return jsonb_build_object('connection_id',c.id,'status',c.status);
end $$;

create or replace function public.revenue_calendar_connections(p_workspace uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u uuid := revenue_private.require_role(p_workspace,'viewer');
begin
 return coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'provider',c.provider,'google_email',c.google_email,'scopes',to_jsonb(c.scopes),'status',c.status,
   'last_error',c.last_error,'last_synced_at',c.last_synced_at,'last_attempt_at',c.last_attempt_at,'next_attempt_at',c.next_attempt_at,
   'consecutive_failures',c.consecutive_failures,'share_meetings',c.share_meetings,'user_timezone',c.user_timezone,'linked',c.token_hash is not null,
   'calendars',coalesce((select jsonb_agg(jsonb_build_object('calendar_id',k.calendar_id,'summary',k.summary,'time_zone',k.time_zone,'access_role',k.access_role,
      'primary',k.is_primary,'available',k.available,'sync_enabled',k.sync_enabled,'write_default',k.write_default,'status',k.status,'last_synced_at',k.last_synced_at,
      'last_error',k.last_error,'events_synced',k.events_synced) order by k.is_primary desc, k.summary) from public.revenue_calendar_calendars k where k.connection_id=c.id),'[]')))
  from public.revenue_calendar_connections c where c.workspace_id=p_workspace and c.user_id=u),'[]');
end $$;

create or replace function public.revenue_calendar_select(p_workspace uuid, p_calendar text, p_sync boolean default null, p_write_default boolean default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.revenue_calendar_connections := revenue_private.own_calendar(p_workspace); k public.revenue_calendar_calendars;
begin
 select * into k from public.revenue_calendar_calendars where connection_id=c.id and calendar_id=p_calendar for update;
 if k.connection_id is null then raise exception '404:Calendar not found for your Google account.'; end if;
 if coalesce(p_write_default,false) and k.access_role not in ('owner','writer') then raise exception '400:You can only create events in calendars you can edit.'; end if;
 if p_sync is not null then
  update public.revenue_calendar_calendars set sync_enabled=p_sync,
   sync_token=case when p_sync then sync_token end,page_token=case when p_sync then page_token end,updated_at=now()
   where connection_id=c.id and calendar_id=p_calendar;
 end if;
 if coalesce(p_write_default,false) then
  update public.revenue_calendar_calendars set write_default=false,updated_at=now() where connection_id=c.id and write_default and calendar_id<>p_calendar;
  update public.revenue_calendar_calendars set write_default=true,updated_at=now() where connection_id=c.id and calendar_id=p_calendar;
 end if;
 perform revenue_private.audit(p_workspace,'user','calendar.selection','calendar_connection',c.id::text,jsonb_build_object('sync',p_sync,'write_default',p_write_default));
 return public.revenue_calendar_connections(p_workspace);
end $$;

create or replace function public.revenue_calendar_settings(p_workspace uuid, p_timezone text default null, p_share boolean default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.revenue_calendar_connections := revenue_private.own_calendar(p_workspace);
begin
 if p_timezone is not null and revenue_private.valid_tz(p_timezone) is null then raise exception '400:Choose a valid time zone.'; end if;
 update public.revenue_calendar_connections set user_timezone=coalesce(p_timezone,user_timezone),share_meetings=coalesce(p_share,share_meetings),updated_at=now() where id=c.id;
 perform revenue_private.audit(p_workspace,'user','calendar.settings','calendar_connection',c.id::text,jsonb_build_object('share_meetings',p_share));
 return public.revenue_calendar_connections(p_workspace);
end $$;

-- Stops CRM recording for the caller's own calendar. Meetings already on customer timelines stay.
create or replace function public.revenue_calendar_disconnect(p_workspace uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid := revenue_private.require_role(p_workspace,'viewer'); c public.revenue_calendar_connections;
begin
 update public.revenue_calendar_connections set status='disconnected',token_hash=null,pending_hash=null,pending_at=null,last_error=null,next_attempt_at=null,updated_at=now()
  where workspace_id=p_workspace and user_id=u returning * into c;
 if c.id is not null then
  delete from public.revenue_calendar_calendars where connection_id=c.id;
  delete from public.revenue_calendar_sync_state where workspace_id=p_workspace and account_id=c.id;
  perform revenue_private.audit(p_workspace,'user','calendar.disconnect','calendar_connection',c.id::text,'{}');
 end if;
 return jsonb_build_object('disconnected',c.id is not null);
end $$;

-- ---------- Onixus Mail (per-connection link token) ----------
create or replace function public.revenue_calendar_activate(p_connection uuid, p_token text, p_account jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.revenue_calendar_connections; granted text[]; sub text := left(nullif(p_account->>'subject',''),255); em text := lower(trim(p_account->>'email'));
begin
 select * into c from public.revenue_calendar_connections where id=p_connection for update;
 if c.id is null or c.pending_hash is null or p_token is null or length(p_token)<32 or c.pending_hash<>revenue_private.token_digest(p_token) or c.pending_at<now()-interval '20 minutes' then
  raise exception '403:This connection request expired. Start connecting Google Calendar again.' using errcode='42501';
 end if;
 if not exists(select 1 from public.crm_memberships where workspace_id=c.workspace_id and user_id=c.user_id and role in ('owner','member')) then
  raise exception '403:The calendar owner can no longer add meetings to this workspace.' using errcode='42501';
 end if;
 if em is null or em !~ '^[^[:space:]@]+@[^[:space:]@]+$' or sub is null then raise exception '400:Google account identity is required.'; end if;
 granted := array(select left(s,200) from jsonb_array_elements_text(case when jsonb_typeof(p_account->'scopes')='array' then p_account->'scopes' else '[]' end) s limit 20);
 -- A different Google account starts with a clean calendar list and sync positions.
 if c.google_subject is distinct from sub then delete from public.revenue_calendar_calendars where connection_id=c.id; end if;
 update public.revenue_calendar_connections set token_hash=pending_hash,pending_hash=null,pending_at=null,google_email=em,google_subject=sub,scopes=granted,
  status=case when 'https://www.googleapis.com/auth/calendar.events'=any(granted) then 'healthy' else 'scope_missing' end,
  last_error=case when 'https://www.googleapis.com/auth/calendar.events'=any(granted) then null else 'Calendar event access was not granted.' end,
  consecutive_failures=0,next_attempt_at=now(),updated_at=now()
  where id=c.id returning * into c;
 perform revenue_private.audit(c.workspace_id,'provider','calendar.connected','calendar_connection',c.id::text,jsonb_build_object('scopes',to_jsonb(granted)));
 return jsonb_build_object('connection_id',c.id,'workspace_id',c.workspace_id,'status',c.status);
end $$;

create or replace function public.revenue_calendar_state(p_connection uuid, p_token text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c public.revenue_calendar_connections := revenue_private.calendar_connection(p_connection,p_token);
begin
 return jsonb_build_object('connection',jsonb_build_object('id',c.id,'workspace_id',c.workspace_id,'status',c.status,'google_email',c.google_email,'share_meetings',c.share_meetings,
   'user_timezone',c.user_timezone,'next_attempt_at',c.next_attempt_at,'consecutive_failures',c.consecutive_failures,'due',c.next_attempt_at is null or c.next_attempt_at<=now()),
  'calendars',coalesce((select jsonb_agg(jsonb_build_object('calendar_id',k.calendar_id,'summary',k.summary,'time_zone',k.time_zone,'access_role',k.access_role,'primary',k.is_primary,
    'sync_enabled',k.sync_enabled,'write_default',k.write_default,'sync_token',k.sync_token,'page_token',k.page_token) order by k.is_primary desc)
   from public.revenue_calendar_calendars k where k.connection_id=c.id and k.available),'[]'));
end $$;

-- The Google calendar list as Mail last read it. New calendars sync only when they are the
-- primary calendar; the user chooses others in Onixus Workspace.
create or replace function public.revenue_calendar_report_calendars(p_connection uuid, p_token text, p_calendars jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.revenue_calendar_connections := revenue_private.calendar_connection(p_connection,p_token); k jsonb; seen text[] := '{}'; id text; role text;
begin
 if jsonb_typeof(p_calendars) is distinct from 'array' then raise exception '400:Calendar list required.'; end if;
 for k in select value from jsonb_array_elements(p_calendars) limit 250 loop
  id := left(nullif(k->>'calendar_id',''),300);
  continue when id is null;
  role := case when k->>'access_role' in ('owner','writer','reader','freeBusyReader') then k->>'access_role' end;
  seen := seen||id;
  insert into public.revenue_calendar_calendars(connection_id,calendar_id,workspace_id,user_id,summary,time_zone,access_role,is_primary,available,sync_enabled,write_default)
  values(c.id,id,c.workspace_id,c.user_id,left(k->>'summary',300),revenue_private.valid_tz(k->>'time_zone'),role,coalesce((k->>'primary')::boolean,false),true,
   coalesce((k->>'primary')::boolean,false),coalesce((k->>'primary')::boolean,false) and coalesce(role in ('owner','writer'),false)
     and not exists(select 1 from public.revenue_calendar_calendars where connection_id=c.id and write_default))
  on conflict(connection_id,calendar_id) do update set summary=excluded.summary,time_zone=coalesce(excluded.time_zone,public.revenue_calendar_calendars.time_zone),
   access_role=coalesce(excluded.access_role,public.revenue_calendar_calendars.access_role),is_primary=excluded.is_primary,available=true,updated_at=now(),
   write_default=public.revenue_calendar_calendars.write_default and coalesce(coalesce(excluded.access_role,public.revenue_calendar_calendars.access_role) in ('owner','writer'),false);
 end loop;
 update public.revenue_calendar_calendars set available=false,updated_at=now() where connection_id=c.id and not (calendar_id=any(seen)) and available;
 return jsonb_build_object('calendars',cardinality(seen));
end $$;

create or replace function public.revenue_calendar_ingest(p_connection uuid, p_token text, p_calendar text, p_event jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.revenue_calendar_connections := revenue_private.calendar_connection(p_connection,p_token); k public.revenue_calendar_calendars;
begin
 select * into k from public.revenue_calendar_calendars where connection_id=c.id and calendar_id=p_calendar;
 if k.connection_id is null then raise exception '404:Calendar not found for this connection.'; end if;
 -- Events created through Onixus Workspace are recorded even when the calendar itself is not synced.
 if not k.sync_enabled and coalesce(p_event->>'origin','')<>'workspace' then return jsonb_build_object('ignored','calendar_not_synced'); end if;
 -- With sharing off nothing new is added, but meetings already on a timeline still get their
 -- reschedules and cancellations so the CRM does not show a meeting that is not happening.
 if not c.share_meetings and not exists(select 1 from public.revenue_meetings where workspace_id=c.workspace_id and provider='google_calendar' and provider_event_id=nullif(p_event->>'provider_event_id','')) then
  return jsonb_build_object('ignored','sharing_off');
 end if;
 return revenue_private.ingest_calendar(c.workspace_id,'google_calendar','Google Calendar',
  (p_event-'origin')||jsonb_build_object('calendar_id',p_calendar,'connection_id',c.id,'time_zone',coalesce(nullif(p_event->>'time_zone',''),k.time_zone)),
  array[c.google_email],false,false);
end $$;

-- After a recurring series is re-expanded: future instances Google no longer returns (series
-- moved, shortened or deleted) are cancelled on the timeline, once.
create or replace function public.revenue_calendar_series(p_connection uuid, p_token text, p_calendar text, p_series text, p_keep text[], p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.revenue_calendar_connections := revenue_private.calendar_connection(p_connection,p_token); m public.revenue_meetings; n integer := 0;
begin
 if p_series is null or length(p_series)>1024 or p_from is null or p_to is null or p_to<=p_from then raise exception '400:Series window is invalid.'; end if;
 for m in select * from public.revenue_meetings where workspace_id=c.workspace_id and provider='google_calendar' and recurring_event_id=p_series and status='scheduled'
   and starts_at>=greatest(p_from,now()) and starts_at<p_to and not (provider_event_id=any(coalesce(p_keep,'{}'))) loop
  perform revenue_private.save_meeting(c.workspace_id,m.customer_id,m.deal_id,false,m.title,m.starts_at,m.ends_at,'cancelled','google_calendar',m.provider_event_id,
   greatest(clock_timestamp(),coalesce(m.provider_updated_at,clock_timestamp())+interval '1 microsecond'),'provider',jsonb_build_object('untrusted_content',true,'source','Google Calendar','series_removed',true));
  n := n+1;
 end loop;
 return jsonb_build_object('cancelled',n);
end $$;

-- Sync outcome. With p_calendar: that calendar's position (advanced only on success, the Mail
-- relay's rules). Without: the connection's health. Failures back off 5 min, 10, 20 ... 6 h;
-- problems that need the user (expired, revoked, missing scope, API disabled) wait 6 h or a reconnect.
create or replace function public.revenue_calendar_report(p_connection uuid, p_token text, p_calendar text, p_report jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.revenue_calendar_connections := revenue_private.calendar_connection(p_connection,p_token); st text := p_report->>'status';
 reset boolean := coalesce((p_report->>'reset')::boolean,false); err text := left(p_report->>'error',500); n integer;
begin
 if p_calendar is not null then
  if st not in ('healthy','error') then raise exception '400:Unsupported calendar status.'; end if;
  update public.revenue_calendar_calendars set status=st,
   sync_token=case when st<>'healthy' then sync_token when reset then p_report->>'sync_token' else coalesce(p_report->>'sync_token',sync_token) end,
   page_token=case when st='healthy' then p_report->>'page_token' else page_token end,
   last_synced_at=case when st='healthy' then now() else last_synced_at end,last_error=case when st='healthy' then null else err end,
   events_synced=events_synced+greatest(coalesce((p_report->>'events_synced')::bigint,0),0),updated_at=now()
   where connection_id=c.id and calendar_id=p_calendar;
  return jsonb_build_object('status',st);
 end if;
 if st not in ('healthy','expired','revoked','scope_missing','api_disabled','error') then raise exception '400:Unsupported calendar status.'; end if;
 n := case when st='healthy' then 0 else c.consecutive_failures+1 end;
 update public.revenue_calendar_connections set status=st,last_error=case when st='healthy' then null else err end,last_attempt_at=now(),
  last_synced_at=case when st='healthy' then now() else last_synced_at end,consecutive_failures=n,
  next_attempt_at=case when st='healthy' then null when st='error' then now()+least(interval '5 minutes'*power(2,least(n-1,7)),interval '6 hours') else now()+interval '6 hours' end,
  updated_at=now() where id=c.id;
 insert into public.revenue_calendar_sync_state(workspace_id,account_id,calendar_id,status,last_synced_at,last_attempt_at,last_error)
 values(c.workspace_id,c.id,'workspace-connection',case st when 'healthy' then 'healthy' when 'scope_missing' then 'scope_missing' when 'error' then 'error' when 'api_disabled' then 'error' else 'expired' end,
  case when st='healthy' then now() end,now(),case when st='healthy' then null else err end)
 on conflict(workspace_id,account_id) do update set status=excluded.status,last_synced_at=coalesce(excluded.last_synced_at,public.revenue_calendar_sync_state.last_synced_at),
  last_attempt_at=now(),last_error=excluded.last_error;
 if st<>'healthy' then
  perform revenue_private.record_event(c.workspace_id,null,null,'calendar.'||st,'calendar','provider',null,now(),'failed','calendar_connection',c.id,
   case st when 'expired' then 'Google Calendar access expired; meetings are not being recorded'
    when 'revoked' then 'Google Calendar access was revoked; meetings are not being recorded'
    when 'scope_missing' then 'Google Calendar access was not fully granted; meetings are not being recorded'
    when 'api_disabled' then 'The Google Calendar API is disabled for the Onixus Google Cloud project'
    else 'Google Calendar sync failed; retrying' end,
   jsonb_build_object('error',left(err,300)),'{}','calendar.'||st||':'||c.id||':'||to_char(now(),'YYYY-MM-DD"T"HH24'),jsonb_build_object('error',left(err,300)),
   case when st in ('expired','revoked','scope_missing') then 'Reconnect Google Calendar in Onixus Workspace settings.'
    when st='api_disabled' then 'Ask the Onixus Google Cloud owner to enable the Google Calendar API, then retry.'
    else 'Sync retries automatically with backoff. If it keeps failing, check Onixus Mail service health.' end);
 end if;
 return jsonb_build_object('status',st,'next_attempt_at',(select next_attempt_at from public.revenue_calendar_connections where id=c.id));
end $$;

-- ---------- priorities: dedicated connections point to Onixus Workspace calendar settings ----------
create or replace function public.revenue_priorities(p_workspace uuid, p_limit integer default 25)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform revenue_private.require_role(p_workspace,'viewer');
 return coalesce((select jsonb_agg(x order by x.severity desc, x.since) from (
  select * from (
   select 3 severity,'failed_send' kind,m.customer_id,c.company who,'A message to '||m.to_email||' failed: '||coalesce(m.failure->>'detail',m.failure->>'reason','unknown error') why,
    case when m.failure->>'reason'='bounce' then 'Verify the address or contact them another way' else 'Fix the cause, then retry the send' end action,m.failed_at since,'/revenue?view=mail&message='||m.id link
   from public.revenue_messages m left join public.crm_customers c on c.id=m.customer_id where m.workspace_id=p_workspace and m.status='failed'
   union all
   select 3,'sync_problem',null,coalesce(s.mailbox,'Mail account'),'Mail sync is '||s.status||coalesce(': '||s.last_error,''),case when s.status='expired' then 'Reconnect Google in Onixus Mail' else 'Retry sync and check Mail service health' end,s.last_attempt_at,'/revenue?view=mail'
   from public.revenue_sync_state s where s.workspace_id=p_workspace and s.status in ('expired','error')
   union all
   select 3,'calendar_problem',null,'Google Calendar','Calendar sync is '||replace(s.status,'_',' ')||coalesce(': '||s.last_error,''),
    case when s.calendar_id='workspace-connection' then case when s.status in ('scope_missing','expired') then 'Reconnect Google Calendar in Onixus Workspace settings' else 'Sync retries automatically; open Calendar settings for details' end
     when s.status='scope_missing' then 'Reconnect Google in Onixus Mail and allow Calendar access' when s.status='expired' then 'Reconnect Google in Onixus Mail' else 'Retry calendar sync and check Mail service health' end,
    s.last_attempt_at,case when s.calendar_id='workspace-connection' then '/settings/calendar' else '/revenue?view=automation' end
   from public.revenue_calendar_sync_state s where s.workspace_id=p_workspace and s.status in ('expired','error','scope_missing')
   union all
   select 2,'send_unassigned',m.customer_id,coalesce(c.company,m.to_email),'An approved message to '||m.to_email||' is waiting because no sending mailbox is chosen','Pick a sender identity linked to a connected mailbox',m.queued_at,'/revenue?view=mail&message='||m.id
   from public.revenue_messages m left join public.crm_customers c on c.id=m.customer_id where m.workspace_id=p_workspace and m.status='queued' and m.account_id is null
    and m.queued_at<now()-interval '15 minutes' and (select count(*) from public.crm_mail_connections x where x.workspace_id=p_workspace)<>1
   union all
   select 3,'dead_job',j.customer_id,coalesce(c.company,'Workflow'),'Automation step '||j.kind||' failed after '||j.attempts||' attempts: '||coalesce(j.last_error,''),'Review the error and replay the job',j.finished_at,'/revenue?view=automation&job='||j.id
   from public.revenue_jobs j left join public.crm_customers c on c.id=j.customer_id where j.workspace_id=p_workspace and j.status='dead' and j.kind<>'mail.send'
   union all
   select 2,'payment_failed',p.customer_id,c.company,'Payment failed for "'||p.title||'"','Send a new payment link or contact the customer',p.updated_at,'/revenue?view=customer&customer='||p.customer_id
   from public.revenue_proposals p join public.crm_customers c on c.id=p.customer_id where p.workspace_id=p_workspace and p.status='payment_failed'
   union all
   select 2,'onboarding_hold',o.customer_id,c.company,'Onboarding is on hold: '||coalesce(o.hold_reason,''),'Review the refund or cancellation with the customer',o.started_at,'/revenue?view=customer&customer='||o.customer_id
   from public.revenue_onboardings o join public.crm_customers c on c.id=o.customer_id where o.workspace_id=p_workspace and o.status='on_hold'
   union all
   select 2,'awaiting_reply',t.customer_id,c.company,'Customer wrote "'||left(t.subject,120)||'" and is waiting for a reply'||case when jsonb_array_length(coalesce(t.unanswered_questions,'[]'))>0 then ' ('||jsonb_array_length(t.unanswered_questions)||' open question(s))' else '' end,
    'Draft and approve a reply',t.last_inbound_at,'/revenue?view=mail&thread='||t.thread_id
   from public.crm_mail_threads t join public.crm_customers c on c.id=t.customer_id where t.workspace_id=p_workspace and t.state='waiting_on_us' and t.last_inbound_at<now()-interval '4 hours'
   union all
   select 2,'overdue_task',k.customer_id,c.company,'"'||k.title||'" was due '||to_char(k.due_at at time zone 'UTC','YYYY-MM-DD'),'Complete it or set a new date',k.due_at,'/revenue?view=customer&customer='||k.customer_id
   from public.crm_tasks k join public.crm_customers c on c.id=k.customer_id where k.workspace_id=p_workspace and k.status='open' and k.due_at<now()
   union all
   select 1,'drafts_waiting',m.customer_id,c.company,'A draft to '||m.to_email||' is waiting for approval','Review and approve or cancel it',m.created_at,'/revenue?view=mail&message='||m.id
   from public.revenue_messages m left join public.crm_customers c on c.id=m.customer_id where m.workspace_id=p_workspace and m.status='drafted' and m.direction='outbound'
   union all
   select 1,'identity_review',r.customer_id,c.company,'Possible duplicate customer ('||replace(r.reason,'_',' ')||')','Merge or mark as different',r.created_at,'/revenue?view=reviews'
   from public.revenue_identity_reviews r join public.crm_customers c on c.id=r.customer_id where r.workspace_id=p_workspace and r.status='open'
   union all
   select 1,'proposal_unpaid',p.customer_id,c.company,'Proposal "'||p.title||'" sent '||to_char(p.sent_at at time zone 'UTC','YYYY-MM-DD')||' is not paid','Follow up on the proposal',p.sent_at,'/revenue?view=customer&customer='||p.customer_id
   from public.revenue_proposals p join public.crm_customers c on c.id=p.customer_id where p.workspace_id=p_workspace and p.status='sent' and p.sent_at<now()-interval '5 days'
  ) all_items order by severity desc, since nulls last limit greatest(1,least(p_limit,100))) x),'[]');
end $$;

-- ---------- RLS and grants ----------
-- Connection rows are visible only to the user who owns them (not to other members or owners of
-- the same workspace). Link tokens, pending tokens and sync positions are never readable.
do $$ begin
 alter table public.revenue_calendar_connections enable row level security;
 alter table public.revenue_calendar_calendars enable row level security;
 revoke all on public.revenue_calendar_connections, public.revenue_calendar_calendars from public, anon, authenticated;
 grant select(id,workspace_id,user_id,provider,google_email,scopes,status,last_error,last_synced_at,last_attempt_at,consecutive_failures,next_attempt_at,share_meetings,user_timezone,created_at,updated_at)
  on public.revenue_calendar_connections to authenticated;
 grant select(connection_id,calendar_id,workspace_id,user_id,summary,time_zone,access_role,is_primary,available,sync_enabled,write_default,status,last_synced_at,last_error,events_synced,updated_at)
  on public.revenue_calendar_calendars to authenticated;
 grant all on public.revenue_calendar_connections, public.revenue_calendar_calendars to service_role;
 drop policy if exists calendar_owner_read on public.revenue_calendar_connections;
 create policy calendar_owner_read on public.revenue_calendar_connections for select to authenticated
  using (user_id=(select auth.uid()) and workspace_id in (select workspace_id from public.crm_memberships where user_id=(select auth.uid())));
 drop policy if exists calendar_owner_read on public.revenue_calendar_calendars;
 create policy calendar_owner_read on public.revenue_calendar_calendars for select to authenticated
  using (user_id=(select auth.uid()) and workspace_id in (select workspace_id from public.crm_memberships where user_id=(select auth.uid())));
end $$;

do $$ declare f text; begin
 foreach f in array array['revenue_calendar_begin(uuid,text)','revenue_calendar_connections(uuid)','revenue_calendar_select(uuid,text,boolean,boolean)',
  'revenue_calendar_settings(uuid,text,boolean)','revenue_calendar_disconnect(uuid)','revenue_priorities(uuid,integer)'] loop
  execute 'revoke all on function public.'||f||' from public, anon';
  execute 'grant execute on function public.'||f||' to authenticated';
 end loop;
 foreach f in array array['revenue_calendar_activate(uuid,text,jsonb)','revenue_calendar_state(uuid,text)','revenue_calendar_report_calendars(uuid,text,jsonb)',
  'revenue_calendar_ingest(uuid,text,text,jsonb)','revenue_calendar_series(uuid,text,text,text,text[],timestamptz,timestamptz)','revenue_calendar_report(uuid,text,text,jsonb)',
  'revenue_mail_calendar_event(uuid,text,jsonb)'] loop
  execute 'revoke all on function public.'||f||' from public';
  execute 'grant execute on function public.'||f||' to anon, authenticated';
 end loop;
 foreach f in array array['revenue_private.valid_tz(text)','revenue_private.meeting_when(timestamptz,text,boolean,date)','revenue_private.token_digest(text)',
  'revenue_private.calendar_connection(uuid,text)','revenue_private.own_calendar(uuid)',
  'revenue_private.save_meeting(uuid,uuid,uuid,boolean,text,timestamptz,timestamptz,text,text,text,timestamptz,text,jsonb)',
  'revenue_private.ingest_calendar(uuid,text,text,jsonb,text[],boolean,boolean)'] loop
  execute 'revoke all on function '||f||' from public, anon, authenticated';
 end loop;
end $$;
commit;
