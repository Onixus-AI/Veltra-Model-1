// Shared with Onixus-AI/Veltra-Mail test/helpers/fake-google-calendar.ts (keep the two copies identical apart from import suffixes).
// In-memory Google OAuth + Calendar API served through a fetch function: token exchange and
// refresh (with revocation), userinfo, calendarList, events.list with syncToken/pageToken and 410,
// instances of weekly series (DST-aware), single-event views, insert/patch/delete with ETags and
// sendUpdates, and injected 401/403/429/5xx failures. No network.
import {localToUtc, type GoogleEvent} from '../../lib/revenue/workspace-calendar';

type Calendar = {id: string; summary: string; timeZone: string; accessRole: string; primary?: boolean};
type Stored = GoogleEvent & {calendarId: string};
const json = (status: number, body: unknown) => new Response(status === 204 ? null : JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
const err = (status: number, message: string, reason: string) => json(status, {error: {code: status, message, errors: [{reason}]}});

export function fakeGoogleCalendar(o: {email: string; sub?: string; calendars?: Calendar[]; pageSize?: number}) {
  const calendars = o.calendars ?? [{id: 'primary', summary: o.email, timeZone: 'America/New_York', accessRole: 'owner', primary: true}];
  const events = new Map<string, Stored>();
  const log: {seq: number; key: string; snapshot: Stored}[] = [];
  let seq = 0, clock = Date.now() - 3_600_000, minToken = 0, tokenCount = 0;
  const valid = new Set<string>();
  const state = {revoked: false, eventsScope: true, listScope: true, apiDisabled: false, grantedScopes: [] as string[], refreshes: 0, exchanges: 0};
  const failures: {match: RegExp; status: number; reason: string; times: number}[] = [];
  const sent: {method: string; calendarId: string; eventId: string | null; sendUpdates: string | null}[] = [];
  const calls: string[] = [];
  const tick = () => new Date(clock += 1000).toISOString();
  const key = (cal: string, id: string) => `${cal}\u0000${id}`;
  const issue = () => { const t = `access-${++tokenCount}`; valid.add(t); return t; };
  const save = (e: Stored) => { e.etag = `"${++seq}"`; events.set(key(e.calendarId, e.id), e); log.push({seq, key: key(e.calendarId, e.id), snapshot: structuredClone(e)}); return e; };
  const pub = (e: Stored): GoogleEvent => { const {calendarId: _c, ...rest} = structuredClone(e); void _c; return rest; };
  const calOf = (raw: string) => calendars.find(c => c.id === decodeURIComponent(raw) || (decodeURIComponent(raw) === 'primary' && c.primary));
  const startMs = (e: GoogleEvent) => Date.parse(e.start?.dateTime ?? `${e.start?.date}T00:00:00Z`);

  function weekly(master: Stored, from: number, to: number): Stored[] {
    const count = Number(/COUNT=(\d+)/.exec(master.recurrence?.join(';') ?? '')?.[1] ?? 10);
    const tz = master.start?.timeZone ?? 'UTC', len = Date.parse(master.end!.dateTime!) - Date.parse(master.start!.dateTime!);
    const first = new Date(Date.parse(master.start!.dateTime!));
    const local = new Intl.DateTimeFormat('sv-SE', {timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(first).replace(' ', 'T');
    const out: Stored[] = [];
    for (let i = 0; i < count; i++) {
      const day = new Date(Date.parse(`${local.slice(0, 10)}T00:00:00Z`) + i * 7 * 86_400_000).toISOString().slice(0, 10);
      const at = localToUtc(`${day}${local.slice(10)}`, tz).utc, ms = Date.parse(at);
      const id = `${master.id}_${at.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}`;
      const exception = events.get(key(master.calendarId, id));
      const instance: Stored = exception ?? {...structuredClone(master), id, recurrence: undefined, recurringEventId: master.id, originalStartTime: {dateTime: at, timeZone: tz},
        start: {dateTime: at, timeZone: tz}, end: {dateTime: new Date(ms + len).toISOString(), timeZone: tz}};
      if (ms + len > from && ms < to) out.push(instance);
    }
    return out;
  }

  const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input)), method = init?.method ?? 'GET';
    calls.push(`${method} ${url.host}${url.pathname}`);
    if (url.host === 'oauth2.googleapis.com') {
      const body = new URLSearchParams(String(init?.body));
      if (!body.get('client_secret')) return json(401, {error: 'invalid_client'});
      if (body.get('grant_type') === 'refresh_token') {
        state.refreshes++;
        if (state.revoked || body.get('refresh_token') !== 'refresh-1') return json(400, {error: 'invalid_grant', error_description: 'Token has been expired or revoked.'});
        return json(200, {access_token: issue(), expires_in: 3599, scope: state.grantedScopes.join(' '), token_type: 'Bearer'});
      }
      state.exchanges++;
      return json(200, {access_token: issue(), refresh_token: 'refresh-1', expires_in: 3599, scope: state.grantedScopes.join(' '), token_type: 'Bearer'});
    }
    const bearer = new Headers(init?.headers).get('authorization')?.replace(/^Bearer /, '') ?? '';
    if (url.host === 'openidconnect.googleapis.com') return valid.has(bearer) ? json(200, {sub: o.sub ?? 'google-sub-1', email: o.email, email_verified: true}) : json(401, {});
    if (url.host !== 'www.googleapis.com') throw new Error(`Unexpected network call to ${url.host}`);
    const failure = failures.find(f => f.match.test(`${method} ${url.pathname}`) && f.times > 0);
    if (failure) { failure.times--; return err(failure.status, failure.status === 429 ? 'Rate Limit Exceeded' : failure.status >= 500 ? 'Backend Error' : 'Forbidden', failure.reason); }
    if (!valid.has(bearer) || state.revoked) return err(401, 'Invalid Credentials', 'authError');
    if (state.apiDisabled) return err(403, 'Google Calendar API has not been used in project 123 before or it is disabled.', 'accessNotConfigured');
    const path = url.pathname.replace(/^\/calendar\/v3/, '');
    if (path === '/users/me/calendarList') {
      if (!state.listScope) return err(403, 'Request had insufficient authentication scopes.', 'insufficientPermissions');
      return json(200, {items: calendars.map(c => ({id: c.id, summary: c.summary, timeZone: c.timeZone, accessRole: c.accessRole, primary: c.primary}))});
    }
    if (!state.eventsScope) return err(403, 'Request had insufficient authentication scopes.', 'insufficientPermissions');
    const m = /^\/calendars\/([^/]+)\/events(?:\/([^/]+))?(\/instances)?$/.exec(path);
    const cal = m && calOf(m[1]);
    if (!m || !cal) return err(404, 'Not Found', 'notFound');
    const id = m[2] ? decodeURIComponent(m[2]) : null;
    if (id && m[3]) {
      const master = events.get(key(cal.id, id));
      if (!master) return err(404, 'Not Found', 'notFound');
      const items = weekly(master, Date.parse(url.searchParams.get('timeMin')!), Date.parse(url.searchParams.get('timeMax')!));
      return json(200, {timeZone: cal.timeZone, items: items.map(pub)});
    }
    if (id) {
      const current = events.get(key(cal.id, id));
      if (!current) return err(404, 'Not Found', 'notFound');
      const match = new Headers(init?.headers).get('if-match');
      if (method !== 'GET' && match && match !== current.etag) return err(412, 'Precondition Failed', 'conditionNotMet');
      if (method === 'GET') return json(200, pub(current));
      sent.push({method, calendarId: cal.id, eventId: id, sendUpdates: url.searchParams.get('sendUpdates')});
      if (method === 'DELETE') { save({...current, status: 'cancelled', updated: tick()}); return json(204, null); }
      const patch = JSON.parse(String(init?.body)) as GoogleEvent;
      return json(200, pub(save({...current, ...patch, id, calendarId: cal.id, updated: tick()})));
    }
    if (method === 'POST') {
      const body = JSON.parse(String(init?.body)) as GoogleEvent;
      const created = save({...body, id: `ev${seq + 1}x${Math.random().toString(36).slice(2, 8)}`, calendarId: cal.id, status: 'confirmed', updated: tick(), htmlLink: 'https://calendar.google.com/event?eid=fake',
        organizer: {email: o.email, self: true}, attendees: (body.attendees ?? []).map(a => ({...a, responseStatus: a.responseStatus ?? 'needsAction'}))});
      sent.push({method, calendarId: cal.id, eventId: created.id, sendUpdates: url.searchParams.get('sendUpdates')});
      return json(200, pub(created));
    }
    const mine = [...events.values()].filter(e => e.calendarId === cal.id);
    if (url.searchParams.get('singleEvents') === 'true') {
      const from = Date.parse(url.searchParams.get('timeMin')!), to = Date.parse(url.searchParams.get('timeMax')!);
      const items = mine.flatMap(e => e.recurrence?.length ? weekly(e, from, to) : e.recurringEventId ? [] : [e])
        .filter(e => e.status !== 'cancelled' && startMs(e) < to && Date.parse(e.end?.dateTime ?? `${e.end?.date}T00:00:00Z`) > from).sort((a, b) => startMs(a) - startMs(b));
      return json(200, {timeZone: cal.timeZone, items: items.map(pub)});
    }
    const size = o.pageSize ?? 250, syncToken = url.searchParams.get('syncToken'), pageToken = url.searchParams.get('pageToken');
    let full = !syncToken, after = 0, offset = 0;
    if (pageToken) { const [mode, a, b] = pageToken.split(':'); full = mode === 'full'; after = Number(a); offset = Number(b); }
    else if (syncToken) {
      after = Number(syncToken.replace(`sync-${cal.id}-`, ''));
      if (!syncToken.startsWith(`sync-${cal.id}-`) || after < minToken) return err(410, 'Sync token is no longer valid, a full sync is required.', 'fullSyncRequired');
    }
    let items: Stored[];
    if (full) items = mine.filter(e => e.status !== 'cancelled');
    else {
      const latest = new Map<string, Stored>();
      for (const entry of log) if (entry.seq > after && entry.snapshot.calendarId === cal.id) latest.set(entry.key, entry.snapshot);
      items = [...latest.values()].map(e => e.status === 'cancelled' ? {id: e.id, status: 'cancelled', calendarId: e.calendarId, ...(e.recurringEventId ? {recurringEventId: e.recurringEventId} : {})} as Stored : e);
    }
    const page = items.slice(offset, offset + size), more = offset + size < items.length;
    return json(200, {timeZone: cal.timeZone, items: page.map(pub), ...(more ? {nextPageToken: `${full ? 'full' : 'inc'}:${after}:${offset + size}`} : {nextSyncToken: `sync-${cal.id}-${seq}`})});
  };

  const me = {email: o.email, self: true, organizer: true, responseStatus: 'accepted'};
  return {
    fetcher: fetcher as typeof fetch, state, sent, calls,
    grant(scopes: string[]) { state.grantedScopes = scopes; },
    /** The connected user organizes a timed meeting with these guests. */
    book(id: string, guests: string[], startUtc: string, o2: {calendar?: string; minutes?: number; title?: string; tz?: string; organizer?: string} = {}) {
      const end = new Date(Date.parse(startUtc) + (o2.minutes ?? 30) * 60_000).toISOString(), tz = o2.tz ?? 'America/New_York';
      const organizer = o2.organizer ? {email: o2.organizer} : {email: o.email, self: true};
      return pub(save({id, calendarId: o2.calendar ?? calendars[0].id, status: 'confirmed', summary: o2.title ?? 'Discovery call', updated: tick(), organizer,
        start: {dateTime: startUtc, timeZone: tz}, end: {dateTime: end, timeZone: tz},
        attendees: [o2.organizer ? {...me, organizer: false} : me, ...guests.map(email => ({email, responseStatus: 'needsAction', ...(email === o2.organizer ? {organizer: true} : {})}))]}));
    },
    allDay(id: string, guests: string[], startDate: string, endDateExclusive: string, calendar = calendars[0].id) {
      return pub(save({id, calendarId: calendar, status: 'confirmed', summary: 'Site visit', updated: tick(), organizer: {email: o.email, self: true},
        start: {date: startDate}, end: {date: endDateExclusive}, attendees: [me, ...guests.map(email => ({email}))]}));
    },
    series(id: string, guests: string[], startUtc: string, weeks: number, tz = 'America/New_York', calendar = calendars[0].id) {
      return pub(save({id, calendarId: calendar, status: 'confirmed', summary: 'Weekly check-in', updated: tick(), organizer: {email: o.email, self: true}, recurrence: [`RRULE:FREQ=WEEKLY;COUNT=${weeks}`],
        start: {dateTime: startUtc, timeZone: tz}, end: {dateTime: new Date(Date.parse(startUtc) + 30 * 60_000).toISOString(), timeZone: tz}, attendees: [me, ...guests.map(email => ({email}))]}));
    },
    update(id: string, change: Partial<GoogleEvent>, calendar = calendars[0].id) { const e = events.get(key(calendar, id))!; return pub(save({...structuredClone(e), ...change, updated: tick()})); },
    cancel(id: string, calendar = calendars[0].id) { const e = events.get(key(calendar, id))!; return pub(save({...structuredClone(e), status: 'cancelled', updated: tick()})); },
    get(id: string, calendar = calendars[0].id) { const e = events.get(key(calendar, id)); return e ? pub(e) : null; },
    expireAccessTokens() { valid.clear(); },
    expireSyncTokens() { minToken = seq + 1; },
    failNext(match: RegExp, status: number, reason: string, times = 1) { failures.push({match, status, reason, times}); },
  };
}
