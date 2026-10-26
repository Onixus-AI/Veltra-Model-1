import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CalendarApiError, calendarApi, confirmsPlan, eventBody, formatInZone, localToUtc, notificationPlan, refreshAccessToken, toIngestEvent, validateDraft, type GoogleEvent} from '../lib/revenue/workspace-calendar';

const rejects = (fn: () => unknown, code: string, message?: RegExp) => assert.throws(fn, (e: unknown) => e instanceof CalendarApiError && e.code === code && (!message || message.test(e.message)));

test('localToUtc converts wall-clock times across DST, refuses skipped times and flags repeated ones', () => {
  assert.deepEqual(localToUtc('2027-03-14T10:30', 'America/New_York'), {utc: '2027-03-14T14:30:00.000Z', offset: '-04:00', ambiguous: false});
  assert.deepEqual(localToUtc('2027-03-13T10:30', 'America/New_York'), {utc: '2027-03-13T15:30:00.000Z', offset: '-05:00', ambiguous: false});
  rejects(() => localToUtc('2027-03-14T02:30', 'America/New_York'), 'rejected', /does not exist/);
  assert.deepEqual(localToUtc('2026-11-01T01:30', 'America/New_York'), {utc: '2026-11-01T05:30:00.000Z', offset: '-04:00', ambiguous: true});
  assert.equal(localToUtc('2026-10-25T01:30', 'Europe/London').ambiguous, true);
  assert.equal(localToUtc('2026-12-01T09:00', 'Asia/Kolkata').utc, '2026-12-01T03:30:00.000Z');
  assert.equal(localToUtc('2026-12-01T09:00', 'Asia/Kolkata').offset, '+05:30');
  assert.equal(localToUtc('2026-12-01T09:00', 'UTC').offset, '+00:00');
  rejects(() => localToUtc('2026-02-30T09:00', 'UTC'), 'rejected');
  rejects(() => localToUtc('2026-12-01T09:00', 'Mars/Olympus'), 'rejected');
});

test('formatInZone shows the event in its own zone and all-day events by date', () => {
  assert.match(formatInZone('2027-03-14T14:30:00.000Z', 'America/New_York'), /Mar 14, 2027.*10:30.*\(America\/New_York\)$/);
  assert.equal(formatInZone('2026-11-01T04:00:00.000Z', 'America/New_York', '2026-11-01'), 'Sun, Nov 1, 2026 (all day)');
});

test('validateDraft normalizes attendees and refuses unsafe or impossible events', () => {
  const ok = validateDraft({title: '  Intro  ', start: '2026-12-01T09:00', end: '2026-12-01T09:30', time_zone: 'America/New_York', attendees: [' Lee@Park.test ', 'lee@park.test']});
  assert.equal(ok.title, 'Intro'); assert.deepEqual(ok.attendees, ['lee@park.test']); assert.equal(ok.all_day, false);
  rejects(() => validateDraft({title: '', start: '2026-12-01T09:00', end: '2026-12-01T09:30', time_zone: 'UTC'}), 'rejected', /title/);
  rejects(() => validateDraft({title: 'x', start: '2026-12-01T09:30', end: '2026-12-01T09:00', time_zone: 'UTC'}), 'rejected', /end after/);
  rejects(() => validateDraft({title: 'x', start: '2026-12-01T09:00', end: '2026-12-20T09:00', time_zone: 'UTC'}), 'rejected', /14 days/);
  rejects(() => validateDraft({title: 'x', start: '2026-12-01T09:00', end: '2026-12-01T10:00', time_zone: 'UTC', attendees: ['a@b.test\r\nBcc: x@y.test']}), 'rejected', /attendee/);
  rejects(() => validateDraft({title: 'x', start: '2026-12-01T09:00', end: '2026-12-01T10:00', time_zone: 'UTC', attendees: Array.from({length: 51}, (_, i) => `p${i}@x.test`)}), 'rejected', /50/);
  rejects(() => validateDraft({title: 'x', start: '2026-12-01T09:00', end: '2026-12-01T10:00', time_zone: 'Nowhere/Land'}), 'rejected', /time zone/);
  const day = validateDraft({title: 'Visit', all_day: true, start: '2026-12-01', end: '2026-12-01', time_zone: 'UTC'});
  assert.equal(day.all_day, true);
  rejects(() => validateDraft({title: 'x', all_day: true, start: '2026-12-02', end: '2026-12-01', time_zone: 'UTC'}), 'rejected');
});

test('eventBody sends explicit offsets, an exclusive all-day end and keeps the organizer and rooms on update', () => {
  const timed = eventBody(validateDraft({title: 'Call', start: '2026-11-01T01:30', end: '2026-11-01T02:00', time_zone: 'America/New_York', attendees: ['lee@park.test']}));
  assert.deepEqual(timed.start, {dateTime: '2026-11-01T01:30:00-04:00', timeZone: 'America/New_York'});
  assert.deepEqual(timed.extendedProperties, {private: {onixus_origin: 'workspace'}});
  const allDay = eventBody(validateDraft({title: 'Visit', all_day: true, start: '2026-12-01', end: '2026-12-02', time_zone: 'UTC'}));
  assert.deepEqual([allDay.start, allDay.end], [{date: '2026-12-01'}, {date: '2026-12-03'}]);
  const before: GoogleEvent = {id: 'e', attendees: [{email: 'me@studio.test', self: true, organizer: true}, {email: 'room@resource.test', resource: true}, {email: 'Lee@Park.test', responseStatus: 'accepted'}, {email: 'gone@x.test'}]};
  const updated = eventBody(validateDraft({title: 'Call', start: '2026-12-01T09:00', end: '2026-12-01T09:30', time_zone: 'UTC', attendees: ['lee@park.test', 'new@x.test']}), before);
  assert.deepEqual(updated.attendees, [{email: 'me@studio.test', self: true, organizer: true}, {email: 'room@resource.test', resource: true}, {email: 'Lee@Park.test', responseStatus: 'accepted'}, {email: 'new@x.test'}]);
  assert.equal('extendedProperties' in updated, false);
});

test('notificationPlan lists exactly who Google will email, and confirmsPlan needs that exact list', () => {
  const draft = validateDraft({title: 'Call', start: '2026-12-01T09:00', end: '2026-12-01T09:30', time_zone: 'UTC', attendees: ['lee@park.test', 'me@studio.test']});
  const created = notificationPlan('create', {self: 'Me@Studio.test', draft, notify: true});
  assert.deepEqual(created, {send_updates: 'all', notified: ['lee@park.test'], added: ['lee@park.test'], removed: [], kept: []});
  assert.equal(confirmsPlan(created, ['LEE@park.test']), true);
  assert.equal(confirmsPlan(created, []), false);
  assert.equal(confirmsPlan(created, ['lee@park.test', 'extra@x.test']), false);
  assert.equal(confirmsPlan(created, true), false);
  assert.equal(confirmsPlan(created, undefined), false);

  const before: GoogleEvent = {id: 'e', attendees: [{email: 'me@studio.test', self: true}, {email: 'lee@park.test'}, {email: 'sam@site.test'}, {email: 'room@r.test', resource: true}]};
  const next = validateDraft({title: 'Call', start: '2026-12-01T09:00', end: '2026-12-01T09:30', time_zone: 'UTC', attendees: ['lee@park.test', 'kim@new.test']});
  const update = notificationPlan('update', {self: 'me@studio.test', before, draft: next, notify: true});
  assert.deepEqual(update, {send_updates: 'all', notified: ['kim@new.test', 'lee@park.test', 'sam@site.test'], added: ['kim@new.test'], removed: ['sam@site.test'], kept: ['lee@park.test']});
  const cancel = notificationPlan('cancel', {self: 'me@studio.test', before, notify: true});
  assert.deepEqual(cancel.notified, ['lee@park.test', 'sam@site.test']);
  const quiet = notificationPlan('cancel', {self: 'me@studio.test', before, notify: false});
  assert.deepEqual([quiet.send_updates, quiet.notified], ['none', []]);
  assert.equal(confirmsPlan(quiet, []), true);
  const alone = notificationPlan('create', {self: 'me@studio.test', draft: validateDraft({title: 'Focus', start: '2026-12-01T09:00', end: '2026-12-01T09:30', time_zone: 'UTC'}), notify: true});
  assert.equal(alone.send_updates, 'none', 'no guests, nobody emailed');
});

test('toIngestEvent maps timed, all-day, cancelled and series events', () => {
  const o = {calendarTz: 'Europe/London', now: Date.parse('2026-11-01T00:00:00Z'), lookbackDays: 30, fetchedAt: '2026-11-01T00:00:00Z'};
  const timed = toIngestEvent({id: 'a', summary: 'Call', start: {dateTime: '2026-11-02T10:00:00Z'}, end: {dateTime: '2026-11-02T10:30:00Z'}, attendees: [{email: 'LEE@Park.test'}], organizer: {email: 'Me@x.test', self: true}, updated: '2026-10-30T00:00:00Z'}, o)!;
  assert.equal(timed.time_zone, 'Europe/London'); assert.equal(timed.attendees[0].email, 'lee@park.test'); assert.equal(timed.organizer_email, 'me@x.test'); assert.equal(timed.organizer_self, true);
  const day = toIngestEvent({id: 'b', start: {date: '2026-11-03'}, end: {date: '2026-11-04'}}, o)!;
  assert.deepEqual([day.all_day, day.start_date, day.end_date, day.starts_at], [true, '2026-11-03', '2026-11-04', null]);
  assert.equal(toIngestEvent({id: 'c', recurrence: ['RRULE:FREQ=WEEKLY'], start: {dateTime: '2026-11-02T10:00:00Z'}, end: {dateTime: '2026-11-02T10:30:00Z'}}, o), null, 'series masters are expanded separately');
  assert.equal(toIngestEvent({id: 'd', start: {dateTime: '2026-08-02T10:00:00Z'}, end: {dateTime: '2026-08-02T10:30:00Z'}}, o), null, 'long past');
  assert.equal(toIngestEvent({id: 'e', status: 'cancelled'}, o)!.status, 'cancelled');
  assert.equal(toIngestEvent({id: 'f', start: {dateTime: '2026-11-02T10:00:00Z'}, end: {dateTime: '2026-11-02T10:30:00Z'}, extendedProperties: {private: {onixus_origin: 'workspace'}}}, o)!.origin, 'workspace');
});

test('calendarApi retries reads and rate limits, but never repeats a write that may have reached Google', async () => {
  const calls: string[] = [];
  let respond: (method: string) => Response = () => Response.json({}, {status: 503});
  const api = calendarApi({token: {get: async () => 'tok'}, sleep: async () => undefined, fetch: (async (url: string, init: RequestInit) => { calls.push(`${init.method ?? 'GET'} ${new URL(url).pathname}`); return respond(init.method ?? 'GET'); }) as typeof fetch});
  await assert.rejects(api.get('primary', 'e1'), (e: CalendarApiError) => e.code === 'temporary');
  assert.equal(calls.length, 4, 'GET retried three times');
  calls.length = 0;
  await assert.rejects(api.insert('primary', {summary: 'x'}, 'all'), (e: CalendarApiError) => e.code === 'temporary');
  assert.equal(calls.length, 1, 'insert is not repeated after a 5xx');
  calls.length = 0;
  let n = 0; respond = () => ++n === 1 ? Response.json({error: {message: 'Rate', errors: [{reason: 'rateLimitExceeded'}]}}, {status: 403}) : Response.json({id: 'new'});
  assert.equal((await api.insert('primary', {summary: 'x'}, 'none')).id, 'new');
  assert.equal(calls.length, 2, 'a rate-limited write was refused by Google and is safe to repeat');
  const errors: [number, unknown, string][] = [
    [403, {error: {message: 'Request had insufficient authentication scopes.', errors: [{reason: 'insufficientPermissions'}]}}, 'scope_missing'],
    [403, {error: {message: 'Google Calendar API has not been used in project 1 before or it is disabled.', errors: [{reason: 'accessNotConfigured'}]}}, 'api_disabled'],
    [410, {error: {message: 'Sync token is no longer valid'}}, 'sync_expired'],
    [412, {error: {message: 'Precondition Failed'}}, 'conflict'],
    [404, {error: {message: 'Not Found'}}, 'not_found'],
    [403, {error: {message: 'Forbidden', errors: [{reason: 'forbidden'}]}}, 'forbidden'],
  ];
  for (const [status, body, code] of errors) {
    respond = () => Response.json(body, {status});
    await assert.rejects(api.get('primary', 'e'), (e: CalendarApiError) => e.code === code, code);
  }
});

test('calendarApi refreshes once on 401, then reports expired; refreshAccessToken maps invalid_grant to revoked', async () => {
  const forced: boolean[] = [];
  const api = calendarApi({token: {get: async (force?: boolean) => { forced.push(Boolean(force)); return 'tok'; }}, sleep: async () => undefined, fetch: (async () => Response.json({}, {status: 401})) as typeof fetch});
  await assert.rejects(api.get('primary', 'e'), (e: CalendarApiError) => e.code === 'expired');
  assert.deepEqual(forced, [false, true]);
  const token = (status: number, body: unknown) => (async () => Response.json(body, {status})) as typeof fetch;
  await assert.rejects(refreshAccessToken({clientId: 'c', clientSecret: 's', refreshToken: 'r', fetch: token(400, {error: 'invalid_grant'})}), (e: CalendarApiError) => e.code === 'revoked');
  await assert.rejects(refreshAccessToken({clientId: 'c', clientSecret: 's', refreshToken: 'r', fetch: token(401, {error: 'invalid_client'})}), (e: CalendarApiError) => e.code === 'expired');
  await assert.rejects(refreshAccessToken({clientId: 'c', clientSecret: 's', refreshToken: 'r', fetch: token(503, {})}), (e: CalendarApiError) => e.code === 'temporary' && e.retryable);
  const ok = await refreshAccessToken({clientId: 'c', clientSecret: 's', refreshToken: 'r', fetch: token(200, {access_token: 'a', expires_in: 3600})});
  assert.equal(ok.access_token, 'a'); assert.ok(ok.expires_at > Date.now());
});
