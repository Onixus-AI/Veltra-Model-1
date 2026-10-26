// Dedicated Google Calendar connections end to end: the shared sync engine (the code Onixus Mail
// runs) against a fake Google Calendar, through real PostgREST on the local revenue database, plus
// the /api/revenue calendar routes. Covers linking, owner-only visibility, syncToken and 410,
// token refresh and revocation, retries, duplicates and out-of-order updates across both sync
// paths, time zones and DST, all-day events and recurring series.
// Needs REVENUE_TEST_DATABASE_URL and REVENUE_TEST_POSTGREST_BIN (see ../helpers/postgrest.ts).
import {after, before, test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash, randomBytes, randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {pgStore, testPool} from '../helpers/pg-store';
import {postgrestHarness, postgrestSkip as skip, SUPABASE} from '../helpers/postgrest';
import {fakeGoogleCalendar} from '../helpers/fake-google-calendar';
import {toRevenueError} from '../../lib/revenue/errors';
import {CALENDAR_EVENTS_SCOPE, CALENDAR_LIST_SCOPE, CALENDAR_SCOPES, calendarApi, refreshAccessToken, syncConnection, type Rpc} from '../../lib/revenue/workspace-calendar';
import {GET as revenueGET, POST as revenuePOST} from '../../app/api/revenue/[...path]/route';

const pg = postgrestHarness();
const {as, jwt} = pg;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const O = randomUUID(), M = randomUUID(), V = randomUUID(), X = randomUUID(), W = randomUUID(), W2 = randomUUID(), MAILBOX = randomUUID();
const MAIL_TOKEN = randomBytes(32).toString('hex');
const OWNER_GOOGLE = 'owner.calendar@studio.test';
let pool: Pool;

async function call<T>(fn: string, args: Record<string, unknown>, authorization: string): Promise<T> {
  const response = await fetch(`${SUPABASE}/rest/v1/rpc/${fn}`, {method: 'POST', headers: {apikey: jwt({role: 'anon'}), Authorization: authorization, 'Content-Type': 'application/json'}, body: JSON.stringify(args)});
  const body = await response.json().catch(() => null);
  if (!response.ok) throw toRevenueError(body ?? new Error(String(response.status)));
  return body as T;
}
const anon: Rpc = (fn, args) => call(fn, args, `Bearer ${jwt({role: 'anon'})}`);
const asUser = <T>(user: string, fn: string, args: Record<string, unknown>) => call<T>(fn, args, `Bearer ${as(user)}`);
const status = async (p: Promise<unknown>) => p.then(() => 200, e => toRevenueError(e).status);

/** What Onixus Mail does on connect: begin with the user's session, then activate after Google returns. */
async function link(user: string, workspace: string, account: {email: string; subject: string; scopes: string[]}) {
  const token = randomBytes(32).toString('base64url');
  const {connection_id} = await asUser<{connection_id: string}>(user, 'revenue_calendar_begin', {p_workspace: workspace, p_pending_hash: sha(token)});
  await anon('revenue_calendar_activate', {p_connection: connection_id, p_token: token, p_account: account});
  return {connection: connection_id, token};
}
/** Mail's server-side token source: cached access token, refreshed when Google says 401. */
function tokens(google: ReturnType<typeof fakeGoogleCalendar>) {
  let access = '';
  return {async get(force?: boolean) {
    if (!access || force) access = (await refreshAccessToken({clientId: 'client', clientSecret: 'secret', refreshToken: 'refresh-1', fetch: google.fetcher})).access_token;
    return access;
  }};
}
const meetings = (provider_event_id?: string) => pool.query(`select * from public.revenue_meetings where workspace_id=$1 ${provider_event_id ? 'and provider_event_id=$2' : ''} order by starts_at`, provider_event_id ? [W, provider_event_id] : [W]).then(r => r.rows);
const timeline = (kind?: string) => pool.query(`select kind,summary,dedupe_key from public.revenue_events where workspace_id=$1 and source='calendar' ${kind ? 'and kind=$2' : ''} order by recorded_at`, kind ? [W, kind] : [W]).then(r => r.rows);
// Upcoming DST changes in America/New_York, so the dates stay in the sync window whenever this runs.
const nthSunday = (year: number, month: number, n: number) => { const d = new Date(Date.UTC(year, month, 1)); d.setUTCDate(1 + ((7 - d.getUTCDay()) % 7) + 7 * (n - 1)); return d.toISOString().slice(0, 10); };
const nextDate = (pick: (y: number) => string) => { const y = new Date().getUTCFullYear(); return pick(y) > new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10) ? pick(y) : pick(y + 1); };
const fallBack = nextDate(y => nthSunday(y, 10, 1)), springForward = nextDate(y => nthSunday(y, 2, 2));
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

before(async () => {
  if (skip) return;
  pool = testPool();
  await pool.query('insert into auth.users(id,email) values ($1,$5),($2,$6),($3,$7),($4,$8)', [O, M, V, X, 'owner@cal.test', 'member@cal.test', 'viewer@cal.test', 'other@cal.test']);
  await pool.query(`insert into public.crm_workspaces(id,name,owner_id,environment) values ($1,'Calendar Studio',$3,'test'),($2,'Other Business',$4,'test')`, [W, W2, O, X]);
  await pool.query(`insert into public.crm_memberships(workspace_id,user_id,role) values ($1,$2,'owner'),($1,$3,'member'),($1,$4,'viewer'),($5,$6,'owner')`, [W, O, M, V, W2, X]);
  await pool.query('insert into public.crm_mail_connections(account_id,workspace_id,token_hash,connected_by) values ($1,$2,$3,$4)', [MAILBOX, W, sha(MAIL_TOKEN), O]);
  for (const c of [{email: 'Lee@Park.test', name: 'Lee Park', company: 'Park Dental'}, {email: 'sam@site.test', name: 'Sam Site', company: 'Site Works'}, {email: 'kim@weekly.test', name: 'Kim', company: 'Weekly Co'}])
    await pgStore(pool, O).rpc('revenue_upsert_customer', {p_workspace: W, p_customer: c});
  await pgStore(pool, X).rpc('revenue_upsert_customer', {p_workspace: W2, p_customer: {email: 'lee@park.test', name: 'Lee elsewhere', company: 'Other'}});
  await pg.start(pool);
});
after(async () => { await pg.stop(); await pool?.end(); });

test('linking: members only, pending token activates once, other users and workspaces see nothing', {skip}, async () => {
  const token = randomBytes(32).toString('base64url');
  assert.equal(await status(asUser(V, 'revenue_calendar_begin', {p_workspace: W, p_pending_hash: sha(token)})), 403, 'viewer cannot add meetings to CRM');
  assert.equal(await status(asUser(X, 'revenue_calendar_begin', {p_workspace: W, p_pending_hash: sha(token)})), 404, 'other workspace');
  assert.equal(await status(anon('revenue_calendar_begin', {p_workspace: W, p_pending_hash: sha(token)})), 401);
  const {connection_id} = await asUser<{connection_id: string}>(M, 'revenue_calendar_begin', {p_workspace: W, p_pending_hash: sha(token)});
  assert.equal(await status(anon('revenue_calendar_activate', {p_connection: connection_id, p_token: 'x'.repeat(43), p_account: {email: 'm@x.test', subject: 's'}})), 403);
  await anon('revenue_calendar_activate', {p_connection: connection_id, p_token: token, p_account: {email: 'Member.Google@Studio.test', subject: 'member-sub', scopes: ['openid', CALENDAR_EVENTS_SCOPE]}});
  assert.equal(await status(anon('revenue_calendar_activate', {p_connection: connection_id, p_token: token, p_account: {email: 'm@x.test', subject: 's'}})), 403, 'pending token is single-use');
  assert.equal(await status(anon('revenue_calendar_state', {p_connection: connection_id, p_token: token})), 200);

  // The member's connection is invisible to the workspace owner, through RPCs, tables and HTTP.
  assert.deepEqual(await asUser(O, 'revenue_calendar_connections', {p_workspace: W}), []);
  const mine = await asUser<{google_email: string; status: string; scopes: string[]}[]>(M, 'revenue_calendar_connections', {p_workspace: W});
  assert.equal(mine.length, 1); assert.equal(mine[0].google_email, 'member.google@studio.test'); assert.equal(mine[0].status, 'healthy');
  const ownerRows = await fetch(`${SUPABASE}/rest/v1/revenue_calendar_connections?select=id,google_email`, {headers: {apikey: jwt({role: 'anon'}), Authorization: `Bearer ${as(O)}`}}).then(r => r.json());
  assert.deepEqual(ownerRows, []);
  const secretColumns = await fetch(`${SUPABASE}/rest/v1/revenue_calendar_connections?select=token_hash`, {headers: {apikey: jwt({role: 'anon'}), Authorization: `Bearer ${as(M)}`}});
  assert.equal(secretColumns.status, 401, 'link token hashes are not readable even by their owner');
  const syncColumns = await fetch(`${SUPABASE}/rest/v1/revenue_calendar_calendars?select=sync_token`, {headers: {apikey: jwt({role: 'anon'}), Authorization: `Bearer ${as(M)}`}});
  assert.equal(syncColumns.status, 401);
  assert.equal(await status(asUser(O, 'revenue_calendar_select', {p_workspace: W, p_calendar: 'primary', p_sync: true})), 404, 'owner cannot change a member calendar');
  assert.equal(await status(asUser(O, 'revenue_calendar_settings', {p_workspace: W, p_share: false})), 404);
  const http = await revenueGET(new Request(`https://web.test/api/revenue/calendar?w=${W}`, {headers: {Authorization: `Bearer ${as(O)}`}}), {params: Promise.resolve({path: ['calendar']})});
  assert.deepEqual(await http.json(), {connections: []});
  // Leaving the workspace revokes the link at once.
  await pool.query('delete from public.crm_memberships where workspace_id=$1 and user_id=$2', [W, M]);
  assert.equal(await status(anon('revenue_calendar_state', {p_connection: connection_id, p_token: token})), 403);
  await pool.query(`insert into public.crm_memberships(workspace_id,user_id,role) values ($1,$2,'member')`, [W, M]);
  await asUser(M, 'revenue_calendar_disconnect', {p_workspace: W});
  assert.equal(await status(anon('revenue_calendar_state', {p_connection: connection_id, p_token: token})), 403, 'disconnect revokes the link token');
});

test('sync: customers linked by normalized email, idempotent resyncs, reschedule, rename, cancel, both sync paths', {skip}, async () => {
  const google = fakeGoogleCalendar({email: OWNER_GOOGLE, calendars: [
    {id: 'primary', summary: OWNER_GOOGLE, timeZone: 'America/New_York', accessRole: 'owner', primary: true},
    {id: 'team@group.calendar.google.com', summary: 'Team', timeZone: 'Europe/London', accessRole: 'reader'}]});
  google.grant(CALENDAR_SCOPES);
  const c = await link(O, W, {email: OWNER_GOOGLE, subject: 'owner-sub', scopes: CALENDAR_SCOPES});
  const api = calendarApi({token: tokens(google), fetch: google.fetcher, sleep: async () => undefined});
  const sync = (force = true) => syncConnection({api, rpc: anon, ...c, force});
  const start = new Date(Date.now() + 3 * 86_400_000); start.setUTCMinutes(0, 0, 0);
  google.book('evt-lee', ['LEE@park.test'], start.toISOString());
  google.book('evt-internal', ['member@cal.test'], start.toISOString(), {title: 'Internal'});
  google.book('evt-stranger', ['nobody@else.test'], start.toISOString(), {title: 'Stranger'});
  google.book('evt-team', ['lee@park.test'], start.toISOString(), {calendar: 'team@group.calendar.google.com', title: 'Team calendar'});

  let r = await sync();
  assert.equal(r.status, 'healthy', JSON.stringify(r));
  assert.deepEqual(r.calendars.map(x => x.calendar_id), ['primary'], 'only the primary calendar syncs by default');
  let [m] = await meetings('evt-lee');
  assert.ok(m, 'meeting recorded');
  assert.equal(m.time_zone, 'America/New_York'); assert.equal(m.calendar_id, 'primary'); assert.equal(m.calendar_connection_id, c.connection);
  assert.equal((await meetings()).length, 1, 'internal-only and unknown attendees are not recorded');
  assert.match((await timeline('meeting.scheduled'))[0].summary, /America\/New_York\)$/);
  const before = (await timeline()).length;
  await sync(); await sync();
  assert.equal((await timeline()).length, before, 'resyncs add nothing');

  // The calendar list is the owner's to change; the second calendar then syncs too.
  const list = await asUser<{calendars: {calendar_id: string; sync_enabled: boolean; write_default: boolean; access_role: string}[]}[]>(O, 'revenue_calendar_connections', {p_workspace: W});
  assert.deepEqual(list[0].calendars.map(k => [k.calendar_id, k.sync_enabled, k.write_default]), [['primary', true, true], ['team@group.calendar.google.com', false, false]]);
  assert.equal(await status(asUser(O, 'revenue_calendar_select', {p_workspace: W, p_calendar: 'team@group.calendar.google.com', p_write_default: true})), 400, 'read-only calendars cannot receive new events');
  const selected = await revenuePOST(new Request('https://web.test/api/revenue/rpc/revenue_calendar_select', {method: 'POST', headers: {Authorization: `Bearer ${as(O)}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({workspace_id: W, args: {p_calendar: 'team@group.calendar.google.com', p_sync: true}})}), {params: Promise.resolve({path: ['rpc', 'revenue_calendar_select']})});
  assert.equal(selected.status, 200);
  r = await sync();
  assert.equal((await meetings('evt-team'))[0]?.time_zone, 'Europe/London', 'calendar time zone applies when the event has none of its own');

  // Reschedule, rename, out-of-order replay and cancel.
  const moved = new Date(start.getTime() + 86_400_000).toISOString();
  google.update('evt-lee', {start: {dateTime: moved, timeZone: 'America/New_York'}, end: {dateTime: new Date(Date.parse(moved) + 1_800_000).toISOString(), timeZone: 'America/New_York'}});
  await sync();
  google.update('evt-lee', {summary: 'Discovery call (renamed)'});
  await sync(); await sync();
  assert.equal((await timeline('meeting.rescheduled')).length, 1);
  assert.equal((await timeline('meeting.updated')).length, 1);
  const stale = await anon<{ignored?: string}>('revenue_calendar_ingest', {...{p_connection: c.connection, p_token: c.token}, p_calendar: 'primary',
    p_event: {provider_event_id: 'evt-lee', status: 'confirmed', title: 'Old title', starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 1_800_000).toISOString(), updated_at: new Date(Date.now() - 86_400_000).toISOString(), organizer_self: true, attendees: [{email: 'lee@park.test'}]}});
  assert.equal(stale.ignored, 'stale_update');
  // The Mail mailbox relay reading the same Google account defers to the dedicated connection.
  const viaMail = await anon<{ignored?: string}>('revenue_mail_calendar_event', {p_account: MAILBOX, p_token: MAIL_TOKEN, p_event: {provider_event_id: 'evt-lee', status: 'confirmed', title: 'x',
    starts_at: moved, ends_at: new Date(Date.parse(moved) + 1_800_000).toISOString(), updated_at: new Date().toISOString(), mailbox: OWNER_GOOGLE.toUpperCase(), organizer_self: true, attendees: [{email: 'lee@park.test'}]}});
  assert.equal(viaMail.ignored, 'dedicated_calendar_connection');
  google.cancel('evt-lee');
  await sync(); await sync();
  [m] = await meetings('evt-lee');
  assert.equal(m.status, 'cancelled'); assert.equal(m.title, 'Discovery call (renamed)');
  assert.equal((await timeline('meeting.cancelled')).length, 1);
  assert.equal((await meetings()).filter(x => x.provider_event_id === 'evt-lee').length, 1, 'one meeting for every copy of the event');

  // 410: the sync position expired. Full resync, no duplicates.
  google.expireSyncTokens();
  const count = (await timeline()).length;
  r = await sync();
  assert.ok(r.calendars.every(x => x.reset), JSON.stringify(r));
  assert.equal((await timeline()).length, count);

  // Access token expiry is refreshed transparently; rate limits and 5xx are retried.
  google.expireAccessTokens();
  google.failNext(/GET \/calendar\/v3\/calendars\/primary\/events/, 429, 'rateLimitExceeded', 2);
  google.failNext(/GET \/calendar\/v3\/users\/me\/calendarList/, 503, 'backendError', 1);
  const refreshes = google.state.refreshes;
  r = await sync();
  assert.equal(r.status, 'healthy', JSON.stringify(r));
  assert.ok(google.state.refreshes > refreshes);

  // Persistent failure on one calendar: reported and backed off, the other calendar still syncs.
  google.failNext(/GET \/calendar\/v3\/calendars\/team/, 500, 'backendError', 10);
  r = await sync();
  assert.equal(r.status, 'error');
  assert.ok(r.calendars.find(x => x.calendar_id === 'primary' && !('error' in x)));
  const [conn] = (await pool.query('select status,consecutive_failures,next_attempt_at from public.revenue_calendar_connections where id=$1', [c.connection])).rows;
  assert.equal(conn.status, 'error'); assert.equal(conn.consecutive_failures, 1); assert.ok(conn.next_attempt_at > new Date());
  assert.equal((await syncConnection({api, rpc: anon, ...c})).status, 'skipped', 'backoff is respected without force');
  await sync();
});

test('time zones: DST-correct UTC storage, all-day events, recurring series expansion and shrink', {skip}, async () => {
  const google = fakeGoogleCalendar({email: OWNER_GOOGLE, sub: 'owner-sub'});
  google.grant(CALENDAR_SCOPES);
  const c = (await pool.query('select id from public.revenue_calendar_connections where workspace_id=$1 and user_id=$2', [W, O])).rows[0].id as string;
  const token = randomBytes(32).toString('base64url');
  await asUser(O, 'revenue_calendar_begin', {p_workspace: W, p_pending_hash: sha(token)});
  await anon('revenue_calendar_activate', {p_connection: c, p_token: token, p_account: {email: OWNER_GOOGLE, subject: 'owner-sub', scopes: CALENDAR_SCOPES}});
  const api = calendarApi({token: tokens(google), fetch: google.fetcher, sleep: async () => undefined});
  const sync = () => syncConnection({api, rpc: anon, connection: c, token, force: true, horizonDays: 120});

  // 10:30 on the spring-forward day in New York is 14:30 UTC (EDT, UTC-4).
  google.book('evt-spring', ['lee@park.test'], `${springForward}T14:30:00.000Z`, {title: 'Spring call'});
  // All-day on the fall-back day: midnight EDT to midnight EST is 25 hours.
  google.allDay('evt-allday', ['sam@site.test'], fallBack, addDays(fallBack, 1));
  // Weekly 09:00 New York across the fall-back change: 13:00 UTC before, 14:00 UTC after.
  const firstWeek = addDays(fallBack, -14);
  google.series('evt-weekly', ['kim@weekly.test'], `${firstWeek}T13:00:00.000Z`, 5);
  const r = await sync();
  assert.equal(r.status, 'healthy', JSON.stringify(r));

  const [spring] = await meetings('evt-spring');
  assert.equal(spring.starts_at.toISOString(), `${springForward}T14:30:00.000Z`);
  assert.equal((await pool.query(`select summary from public.revenue_events where workspace_id=$1 and subject_id=$2`, [W, spring.id])).rows[0].summary, `Meeting booked: Spring call (${springForward} 10:30 America/New_York)`);

  const [allDay] = await meetings('evt-allday');
  assert.equal(allDay.all_day, true); assert.equal(allDay.time_zone, 'America/New_York');
  assert.equal(allDay.starts_at.toISOString(), `${fallBack}T04:00:00.000Z`);
  assert.equal(allDay.ends_at.toISOString(), `${addDays(fallBack, 1)}T05:00:00.000Z`);
  assert.match((await timeline('meeting.scheduled')).find(e => e.summary.includes('Site visit'))!.summary, new RegExp(`${fallBack} \\(all day\\)`));

  const weekly = (await meetings()).filter(x => x.recurring_event_id === 'evt-weekly');
  assert.equal(weekly.length, 5);
  assert.deepEqual(weekly.map(x => x.starts_at.toISOString().slice(11, 16)), ['13:00', '13:00', '14:00', '14:00', '14:00']);
  assert.ok(weekly.every(x => x.time_zone === 'America/New_York'));

  // Shorten the series to 3 weeks: the two dropped future instances are cancelled once.
  google.update('evt-weekly', {recurrence: ['RRULE:FREQ=WEEKLY;COUNT=3']});
  await sync(); await sync();
  const after = (await meetings()).filter(x => x.recurring_event_id === 'evt-weekly');
  assert.deepEqual(after.map(x => x.status), ['scheduled', 'scheduled', 'scheduled', 'cancelled', 'cancelled']);
  assert.equal((await pool.query(`select count(*)::int n from public.revenue_events where workspace_id=$1 and kind='meeting.cancelled' and subject_id = any($2)`, [W, after.map(x => x.id)])).rows[0].n, 2);
  // Deleting the series cancels the rest.
  google.cancel('evt-weekly');
  await sync();
  assert.ok((await meetings()).filter(x => x.recurring_event_id === 'evt-weekly' && x.starts_at > new Date()).every(x => x.status === 'cancelled'));
});

test('connection errors: revoked grant, missing scope, API disabled and calendar-list fallback are visible with a recovery', {skip}, async () => {
  const google = fakeGoogleCalendar({email: 'second@studio.test'});
  google.grant(['openid', 'email', CALENDAR_EVENTS_SCOPE]);
  const c = await link(M, W, {email: 'second@studio.test', subject: 'second-sub', scopes: ['openid', 'email', CALENDAR_EVENTS_SCOPE]});
  const api = calendarApi({token: tokens(google), fetch: google.fetcher, sleep: async () => undefined});
  const sync = () => syncConnection({api, rpc: anon, ...c, force: true});
  const health = async () => (await asUser<{status: string; last_error: string; calendars: {calendar_id: string}[]}[]>(M, 'revenue_calendar_connections', {p_workspace: W}))[0];

  // No calendar-list permission: only the primary calendar is offered.
  google.state.listScope = false;
  assert.equal((await sync()).status, 'healthy');
  assert.deepEqual((await health()).calendars.map(k => k.calendar_id), ['primary']);

  google.state.eventsScope = false;
  assert.equal((await sync()).status, 'scope_missing');
  assert.equal((await health()).status, 'scope_missing');
  google.state.eventsScope = true;
  google.state.apiDisabled = true;
  assert.equal((await sync()).status, 'api_disabled');
  assert.match((await health()).last_error, /not enabled/);
  google.state.apiDisabled = false;
  google.state.revoked = true;
  google.expireAccessTokens();
  const r = await syncConnection({api: calendarApi({token: tokens(google), fetch: google.fetcher, sleep: async () => undefined}), rpc: anon, ...c, force: true});
  assert.equal(r.status, 'revoked');
  assert.equal((await health()).status, 'revoked');
  const priorities = await pgStore(pool, V).rpc<{kind: string; action: string; link: string}[]>('revenue_priorities', {p_workspace: W, p_limit: 50});
  const problem = priorities.find(p => p.kind === 'calendar_problem' && p.link === '/settings/calendar');
  assert.ok(problem, JSON.stringify(priorities));
  assert.equal(problem!.action, 'Reconnect Google Calendar in Onixus Workspace settings');
  assert.ok(!JSON.stringify(priorities).includes('second@studio.test'), 'teammates see that a calendar needs attention, not whose account');

  // A token for one connection cannot act for another, or in another workspace.
  const other = await link(X, W2, {email: 'x@other.test', subject: 'x-sub', scopes: CALENDAR_SCOPES});
  assert.equal(await status(anon('revenue_calendar_state', {p_connection: c.connection, p_token: other.token})), 403);
  assert.equal(await status(anon('revenue_calendar_ingest', {p_connection: other.connection, p_token: c.token, p_calendar: 'primary', p_event: {}})), 403);
});
