// Shared with Onixus-AI/Veltra-Mail src/revenue/workspace-calendar.ts (keep the two copies identical apart from import suffixes).
import {RevenueError} from './errors';

// Dedicated Google Calendar connections for Onixus Workspace users. Onixus Mail holds the grant
// (sealed, refreshed server-side) and runs this module; the web app's harness runs the same code
// against PostgREST. Three parts:
//  * calendarApi: Google Calendar REST with retries and error classification.
//  * syncConnection: incremental sync per selected calendar (syncToken, 410 full resync,
//    recurring series expansion) into revenue_calendar_* RPCs, authenticated by a link token.
//  * Event drafts and the notification plan shown before anything is sent to attendees.
// Event descriptions are never read during sync; titles are stored as untrusted external text.

export const CALENDAR_EVENTS_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
export const CALENDAR_LIST_SCOPE = 'https://www.googleapis.com/auth/calendar.calendarlist.readonly';
export const CALENDAR_SCOPES = ['openid', 'email', CALENDAR_EVENTS_SCOPE, CALENDAR_LIST_SCOPE];

export type CalendarErrorCode = 'expired' | 'revoked' | 'scope_missing' | 'api_disabled' | 'rate_limited' | 'temporary' | 'not_found' | 'conflict' | 'sync_expired' | 'forbidden' | 'rejected';
export class CalendarApiError extends Error {
  constructor(public code: CalendarErrorCode, message: string, public retryable = false) { super(message); }
}

export type Rpc = <T = unknown>(fn: string, args: Record<string, unknown>) => Promise<T>;
export type TokenSource = {get(force?: boolean): Promise<string>};
type Fetch = typeof fetch;

/** Exchanges a refresh token. invalid_grant means the grant was revoked or expired at Google. */
export async function refreshAccessToken(o: {clientId: string; clientSecret: string; refreshToken: string; fetch?: Fetch; tokenUrl?: string}) {
  const response = await (o.fetch ?? fetch)(o.tokenUrl ?? 'https://oauth2.googleapis.com/token', {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({client_id: o.clientId, client_secret: o.clientSecret, refresh_token: o.refreshToken, grant_type: 'refresh_token'}), signal: AbortSignal.timeout(15000)}).catch(() => null);
  const data = response ? await response.json().catch(() => ({})) as {access_token?: string; expires_in?: number; refresh_token?: string; scope?: string; error?: string} : {};
  if (!response || !response.ok || typeof data.access_token !== 'string') {
    if (data.error === 'invalid_grant') throw new CalendarApiError('revoked', 'Google Calendar access expired or was revoked. Reconnect Google Calendar.');
    if (response && (response.status === 400 || response.status === 401)) throw new CalendarApiError('expired', 'Google Calendar sign-in is no longer valid. Reconnect Google Calendar.');
    throw new CalendarApiError('temporary', 'Google sign-in is temporarily unavailable.', true);
  }
  return {access_token: data.access_token, refresh_token: data.refresh_token, expires_at: Date.now() + Math.max(0, Number(data.expires_in) || 0) * 1000, scope: data.scope};
}

export type GoogleDate = {dateTime?: string; date?: string; timeZone?: string};
export type GoogleAttendee = {email?: string; displayName?: string; self?: boolean; resource?: boolean; organizer?: boolean; responseStatus?: string; optional?: boolean};
export type GoogleEvent = {
  id: string; status?: string; summary?: string; description?: string; location?: string; updated?: string; etag?: string; htmlLink?: string; iCalUID?: string;
  recurrence?: string[]; recurringEventId?: string; originalStartTime?: GoogleDate; start?: GoogleDate; end?: GoogleDate;
  organizer?: {email?: string; self?: boolean; displayName?: string}; attendees?: GoogleAttendee[]; extendedProperties?: {private?: Record<string, string>};
};
export type CalendarListEntry = {calendar_id: string; summary: string | null; time_zone: string | null; access_role: string | null; primary: boolean};
type Page = {items?: GoogleEvent[]; nextPageToken?: string; nextSyncToken?: string; timeZone?: string};

export function calendarApi(o: {token: TokenSource; fetch?: Fetch; apiUrl?: string; retries?: number; sleep?: (ms: number) => Promise<void>}) {
  const net = o.fetch ?? fetch, api = (o.apiUrl ?? 'https://www.googleapis.com/calendar/v3').replace(/\/$/, '');
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
  const retries = o.retries ?? 3;

  async function call<T>(path: string, init: RequestInit = {}, attempt = 0, refreshed = false): Promise<T> {
    const response = await net(api + path, {...init, redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: {...init.headers as Record<string, string>, Authorization: `Bearer ${await o.token.get(refreshed)}`}}).catch(() => null);
    if (response?.ok) return (response.status === 204 ? null : await response.json()) as T;
    const detail = response ? await response.json().catch(() => ({})) as {error?: {message?: string; errors?: {reason?: string}[]}} : {};
    const message = detail.error?.message?.slice(0, 200) ?? (response ? `Google Calendar returned ${response.status}` : 'Google Calendar did not respond.');
    const reasons = `${(detail.error?.errors ?? []).map(x => x.reason ?? '').join(' ')} ${message}`;
    const status = response?.status ?? 0;
    if (status === 401) {
      if (!refreshed) return call<T>(path, init, attempt, true);
      throw new CalendarApiError('expired', 'Google Calendar access expired. Reconnect Google Calendar.');
    }
    if (status === 410) throw new CalendarApiError('sync_expired', 'Calendar sync position expired; a full resync is required.', true);
    const limited = status === 429 || (status === 403 && /rateLimitExceeded|userRateLimitExceeded|quotaExceeded/i.test(reasons));
    if (limited || status >= 500 || status === 0) {
      // A write that failed mid-flight may have reached Google; repeating it could invite people twice.
      const repeatable = limited || !init.method || init.method === 'GET';
      if (attempt < retries && repeatable) {
        const after = Number(response?.headers.get('retry-after'));
        await sleep(Math.min(10_000, Number.isFinite(after) && after > 0 ? after * 1000 : 500 * 2 ** attempt + Math.floor(Math.random() * 250)));
        return call<T>(path, init, attempt + 1, refreshed);
      }
      throw new CalendarApiError(limited ? 'rate_limited' : 'temporary', limited ? 'Google Calendar rate limit reached; retrying later.' : 'Google Calendar is temporarily unavailable.', true);
    }
    if (status === 403 && /insufficientPermissions|insufficient authentication scopes|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(reasons))
      throw new CalendarApiError('scope_missing', 'Google Calendar access was not fully granted. Reconnect Google Calendar and allow the requested Calendar permissions.');
    if (status === 403 && /accessNotConfigured|has not been used|is disabled|SERVICE_DISABLED/i.test(reasons))
      throw new CalendarApiError('api_disabled', 'The Google Calendar API is not enabled for the Onixus Google Cloud project.');
    if (status === 404 || status === 410) throw new CalendarApiError('not_found', 'This calendar or event is not available to the connected Google account.');
    if (status === 412) throw new CalendarApiError('conflict', 'The event changed in Google Calendar after you reviewed it. Review the change again.');
    if (status === 403) throw new CalendarApiError('forbidden', 'Google Calendar does not allow this account to change that event.');
    throw new CalendarApiError('rejected', message);
  }
  const cal = (id: string) => `/calendars/${encodeURIComponent(id)}`;
  const write = (sendUpdates: 'all' | 'none') => new URLSearchParams({sendUpdates, conferenceDataVersion: '0'});

  return {
    async listCalendars(): Promise<CalendarListEntry[]> {
      const out: CalendarListEntry[] = [];
      let page: string | undefined;
      do {
        const params = new URLSearchParams({maxResults: '250', minAccessRole: 'reader', ...(page ? {pageToken: page} : {})});
        const r = await call<{items?: {id: string; summary?: string; summaryOverride?: string; timeZone?: string; accessRole?: string; primary?: boolean; deleted?: boolean}[]; nextPageToken?: string}>(`/users/me/calendarList?${params}`);
        for (const c of r.items ?? []) if (!c.deleted && c.id) out.push({calendar_id: c.id, summary: (c.summaryOverride ?? c.summary ?? null)?.slice(0, 300) ?? null, time_zone: c.timeZone ?? null, access_role: c.accessRole ?? null, primary: Boolean(c.primary)});
        page = r.nextPageToken;
      } while (page && out.length < 250);
      return out;
    },
    changes(calendarId: string, syncToken: string | null, pageToken: string | null) {
      const params = new URLSearchParams({maxResults: '250', singleEvents: 'false', showDeleted: 'true'});
      if (syncToken) params.set('syncToken', syncToken);
      if (pageToken) params.set('pageToken', pageToken);
      return call<Page>(`${cal(calendarId)}/events?${params}`);
    },
    async instances(calendarId: string, eventId: string, from: Date, to: Date) {
      const items: GoogleEvent[] = [];
      let page: string | undefined, tz: string | undefined;
      do {
        const params = new URLSearchParams({timeMin: from.toISOString(), timeMax: to.toISOString(), maxResults: '250', showDeleted: 'true', ...(page ? {pageToken: page} : {})});
        const r = await call<Page>(`${cal(calendarId)}/events/${encodeURIComponent(eventId)}/instances?${params}`);
        items.push(...r.items ?? []); tz = tz ?? r.timeZone; page = r.nextPageToken;
      } while (page && items.length < 500);
      return {items, timeZone: tz ?? null};
    },
    /** Display view: single instances in a window, ordered by start. */
    async upcoming(calendarId: string, from: Date, to: Date, limit = 250) {
      const params = new URLSearchParams({timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: String(Math.min(250, limit))});
      const r = await call<Page>(`${cal(calendarId)}/events?${params}`);
      return {items: r.items ?? [], timeZone: r.timeZone ?? null};
    },
    get(calendarId: string, eventId: string) { return call<GoogleEvent>(`${cal(calendarId)}/events/${encodeURIComponent(eventId)}`); },
    insert(calendarId: string, body: Record<string, unknown>, sendUpdates: 'all' | 'none') {
      return call<GoogleEvent>(`${cal(calendarId)}/events?${write(sendUpdates)}`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
    },
    patch(calendarId: string, eventId: string, body: Record<string, unknown>, sendUpdates: 'all' | 'none', etag?: string) {
      return call<GoogleEvent>(`${cal(calendarId)}/events/${encodeURIComponent(eventId)}?${write(sendUpdates)}`, {method: 'PATCH',
        headers: {'Content-Type': 'application/json', ...(etag ? {'If-Match': etag} : {})}, body: JSON.stringify(body)});
    },
    cancel(calendarId: string, eventId: string, sendUpdates: 'all' | 'none', etag?: string) {
      return call<null>(`${cal(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=${sendUpdates}`, {method: 'DELETE', headers: etag ? {'If-Match': etag} : {}});
    },
  };
}
export type CalendarApi = ReturnType<typeof calendarApi>;

// ---------- time zones ----------
export function validTimeZone(tz: unknown): string | null {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return null;
  try { new Intl.DateTimeFormat('en-US', {timeZone: tz}); return tz; } catch { return null; }
}
function offsetMinutes(utcMs: number, tz: string) {
  const parts = new Intl.DateTimeFormat('en-US', {timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'}).formatToParts(new Date(utcMs));
  const v = (t: string) => Number(parts.find(p => p.type === t)?.value);
  return (Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute'), v('second')) - Math.floor(utcMs / 1000) * 1000) / 60000;
}
const pad = (n: number) => String(Math.abs(n)).padStart(2, '0');
const offsetText = (m: number) => `${m < 0 ? '-' : '+'}${pad(Math.trunc(m / 60))}:${pad(m % 60)}`;

/**
 * Wall-clock time in a zone to an instant. A time skipped by a DST change is refused; a time
 * that happens twice uses the first occurrence and says so.
 */
export function localToUtc(local: string, tz: string): {utc: string; offset: string; ambiguous: boolean} {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  const zone = validTimeZone(tz);
  if (!m || !zone) throw new CalendarApiError('rejected', 'Enter a valid date, time and time zone.');
  const naive = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  if (new Date(naive).toISOString().slice(0, 16) !== local) throw new CalendarApiError('rejected', 'Enter a valid date and time.');
  const offsets = [...new Set([offsetMinutes(naive - 86_400_000, zone), offsetMinutes(naive + 86_400_000, zone), offsetMinutes(naive, zone)])];
  const hits = [...new Set(offsets.map(o => naive - o * 60_000).filter(c => naive - c === offsetMinutes(c, zone) * 60_000))].sort((a, b) => a - b);
  if (!hits.length) throw new CalendarApiError('rejected', `${local.replace('T', ' ')} does not exist in ${zone} (the clocks change then). Choose another time.`);
  return {utc: new Date(hits[0]).toISOString(), offset: offsetText(offsetMinutes(hits[0], zone)), ambiguous: hits.length > 1};
}

export function formatInZone(utc: string, tz: string, allDayDate?: string | null) {
  if (allDayDate) return `${new Intl.DateTimeFormat('en-US', {timeZone: 'UTC', weekday: 'short', year: 'numeric', month: 'short', day: 'numeric'}).format(new Date(`${allDayDate}T00:00:00Z`))} (all day)`;
  const zone = validTimeZone(tz) ?? 'UTC';
  return `${new Intl.DateTimeFormat('en-US', {timeZone: zone, weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short'}).format(new Date(utc))} (${zone})`;
}
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

// ---------- drafts and the notification plan ----------
export type EventDraft = {title: string; description: string; location: string; all_day: boolean; start: string; end: string; time_zone: string; attendees: string[]};
const EMAIL = /^[^\s@<>(),;:"[\]]+@[^\s@<>(),;:"[\]]+\.[^\s@<>(),;:"[\]]+$/;
export const normalizeEmail = (e: string) => e.trim().toLowerCase();

export function validateDraft(input: unknown): EventDraft {
  const d = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const text = (v: unknown, max: number) => typeof v === 'string' ? v.trim().slice(0, max) : '';
  const title = text(d.title, 300);
  if (!title) throw new CalendarApiError('rejected', 'Add a title for the event.');
  const zone = validTimeZone(d.time_zone);
  if (!zone) throw new CalendarApiError('rejected', 'Choose a valid time zone.');
  const all_day = d.all_day === true, start = text(d.start, 16), end = text(d.end, 16);
  if (all_day) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end))) throw new CalendarApiError('rejected', 'Enter valid start and end dates.');
    if (end < start) throw new CalendarApiError('rejected', 'The end date must be on or after the start date.');
  } else {
    const a = localToUtc(start, zone), b = localToUtc(end, zone);
    if (Date.parse(b.utc) <= Date.parse(a.utc)) throw new CalendarApiError('rejected', 'The event must end after it starts.');
    if (Date.parse(b.utc) - Date.parse(a.utc) > 14 * 86_400_000) throw new CalendarApiError('rejected', 'Timed events can last at most 14 days.');
  }
  const raw = Array.isArray(d.attendees) ? d.attendees : [];
  if (raw.length > 50) throw new CalendarApiError('rejected', 'Add at most 50 attendees.');
  const attendees = [...new Set(raw.map(x => normalizeEmail(String(x))).filter(Boolean))];
  const bad = attendees.find(a => !EMAIL.test(a) || a.length > 254);
  if (bad) throw new CalendarApiError('rejected', `Check the attendee address ${bad.slice(0, 80)}.`);
  return {title, description: text(d.description, 8000), location: text(d.location, 500), all_day, start, end, time_zone: zone, attendees};
}

/** The Google event body. Timed events carry an explicit offset so DST-ambiguous times stay as previewed. */
export function eventBody(d: EventDraft, before?: GoogleEvent | null) {
  const when = (local: string) => d.all_day ? {date: local} : {dateTime: `${local}:00${localToUtc(local, d.time_zone).offset}`, timeZone: d.time_zone};
  const prior = new Map((before?.attendees ?? []).filter(a => a.email).map(a => [normalizeEmail(a.email!), a]));
  const keep = (before?.attendees ?? []).filter(a => a.self || a.organizer || a.resource);
  const attendees = [...keep, ...d.attendees.filter(e => !keep.some(k => k.email && normalizeEmail(k.email) === e)).map(e => prior.get(e) ?? {email: e})];
  return {summary: d.title, description: d.description || undefined, location: d.location || undefined,
    start: when(d.start), end: d.all_day ? {date: addDays(d.end, 1)} : when(d.end), attendees,
    ...(before ? {} : {extendedProperties: {private: {onixus_origin: 'workspace'}}})};
}

export type NotificationPlan = {send_updates: 'all' | 'none'; notified: string[]; added: string[]; removed: string[]; kept: string[]};
const guests = (list: GoogleAttendee[] | string[] | undefined, self: string) => [...new Set((list ?? []).map(a => typeof a === 'string' ? {email: a} as GoogleAttendee : a)
  .filter(a => a.email && !a.self && !a.resource && normalizeEmail(a.email) !== self).map(a => normalizeEmail(a.email!)))].sort();

/**
 * Who Google will email. Create: every guest. Update: current and removed guests (removed ones get
 * a cancellation). Cancel: every guest. With notify=false nobody is emailed (sendUpdates=none).
 */
export function notificationPlan(action: 'create' | 'update' | 'cancel', o: {self: string; before?: GoogleEvent | null; draft?: EventDraft | null; notify: boolean}): NotificationPlan {
  const self = normalizeEmail(o.self), before = guests(o.before?.attendees, self), after = action === 'cancel' ? [] : guests(o.draft?.attendees, self);
  const added = after.filter(e => !before.includes(e)), removed = before.filter(e => !after.includes(e)), kept = after.filter(e => before.includes(e));
  const everyone = action === 'create' ? after : action === 'cancel' ? before : [...new Set([...after, ...removed])].sort();
  return {send_updates: o.notify && everyone.length ? 'all' : 'none', notified: o.notify ? everyone : [], added, removed, kept};
}

/** The person must confirm exactly the addresses that will be emailed (none when nobody is). */
export function confirmsPlan(plan: NotificationPlan, confirmed: unknown) {
  if (!Array.isArray(confirmed)) return false;
  const list = [...new Set(confirmed.map(x => normalizeEmail(String(x))))].sort();
  return list.length === plan.notified.length && list.every((e, i) => e === plan.notified[i]);
}

// ---------- sync ----------
export type IngestEvent = {
  provider_event_id: string; status: 'confirmed' | 'tentative' | 'cancelled'; title: string | null; starts_at: string | null; ends_at: string | null;
  all_day: boolean; start_date: string | null; end_date: string | null; time_zone: string | null; updated_at: string;
  recurring_event_id: string | null; ical_uid: string | null; organizer_email: string | null; organizer_self: boolean;
  attendees: {email: string; name: string | null; self: boolean; resource: boolean; organizer: boolean; response_status: string | null}[];
  origin?: 'workspace';
};

/** Google event -> ingestion shape, or null for series masters (expanded separately) and long-past events. */
export function toIngestEvent(e: GoogleEvent, o: {calendarTz: string | null; now: number; lookbackDays: number; fetchedAt: string}): IngestEvent | null {
  const cancelled = e.status === 'cancelled';
  const allDay = Boolean(e.start?.date && !e.start?.dateTime);
  if (!cancelled) {
    if (e.recurrence?.length) return null;
    if (allDay ? !e.start?.date || !e.end?.date : !e.start?.dateTime || !e.end?.dateTime) return null;
    const ends = allDay ? Date.parse(`${e.end!.date}T00:00:00Z`) + 86_400_000 : Date.parse(e.end!.dateTime!);
    if (ends < o.now - o.lookbackDays * 86_400_000) return null;
  }
  return {
    provider_event_id: e.id, status: cancelled ? 'cancelled' : e.status === 'tentative' ? 'tentative' : 'confirmed',
    title: e.summary?.slice(0, 300) ?? null, starts_at: allDay ? null : e.start?.dateTime ?? null, ends_at: allDay ? null : e.end?.dateTime ?? null,
    all_day: allDay, start_date: allDay ? e.start?.date ?? null : null, end_date: allDay ? e.end?.date ?? null : null,
    time_zone: validTimeZone(e.start?.timeZone) ?? validTimeZone(o.calendarTz), updated_at: e.updated ?? o.fetchedAt,
    recurring_event_id: e.recurringEventId ?? null, ical_uid: e.iCalUID ?? null,
    organizer_email: e.organizer?.email?.toLowerCase() ?? null, organizer_self: Boolean(e.organizer?.self),
    attendees: (e.attendees ?? []).filter(a => a.email).slice(0, 100).map(a => ({email: normalizeEmail(a.email!), name: a.displayName?.slice(0, 160) ?? null,
      self: Boolean(a.self), resource: Boolean(a.resource), organizer: Boolean(a.organizer), response_status: a.responseStatus ?? null})),
    ...(e.extendedProperties?.private?.onixus_origin === 'workspace' ? {origin: 'workspace' as const} : {}),
  };
}

type StateCalendar = {calendar_id: string; summary: string | null; time_zone: string | null; access_role: string | null; primary: boolean; sync_enabled: boolean; write_default: boolean; sync_token: string | null; page_token: string | null};
export type ConnectionState = {connection: {id: string; workspace_id: string; status: string; google_email: string | null; share_meetings: boolean; user_timezone: string | null; due: boolean}; calendars: StateCalendar[]};
export type ConnectionStatus = 'healthy' | 'expired' | 'revoked' | 'scope_missing' | 'api_disabled' | 'error' | 'unlinked';
export type SyncReport = {status: ConnectionStatus | 'skipped'; calendars: {calendar_id: string; ingested: number; ignored: number; skipped: number; rejected: number; reset: boolean; series: number; error?: string}[]; error?: string};

const statusOf = (e: unknown): Exclude<ConnectionStatus, 'healthy'> => {
  if (e instanceof RevenueError && e.status === 403) return 'unlinked';
  if (!(e instanceof CalendarApiError)) return 'error';
  return e.code === 'expired' || e.code === 'revoked' || e.code === 'scope_missing' || e.code === 'api_disabled' ? e.code : 'error';
};

/**
 * One pass for one connection. Each calendar's sync position advances only after every event in
 * the page was accepted (or permanently rejected), so a failure mid-page is retried from the same
 * position. A 410 restarts that calendar with a full sync; dedupe in the database makes the
 * replay harmless.
 */
export async function syncConnection(o: {api: CalendarApi; rpc: Rpc; connection: string; token: string; force?: boolean; now?: () => number;
  lookbackDays?: number; horizonDays?: number; maxPages?: number; listCalendars?: boolean}): Promise<SyncReport> {
  const args = {p_connection: o.connection, p_token: o.token};
  const now = o.now ?? Date.now, lookbackDays = o.lookbackDays ?? 30, horizonDays = o.horizonDays ?? 90;
  let state: ConnectionState;
  try { state = await o.rpc<ConnectionState>('revenue_calendar_state', args); }
  catch (e) { return {status: statusOf(e), calendars: [], error: e instanceof Error ? e.message : 'Onixus CRM is unavailable.'}; }
  if (!o.force && !state.connection.due) return {status: 'skipped', calendars: []};
  const report: SyncReport = {status: 'healthy', calendars: []};
  try {
    if (o.listCalendars !== false) {
      let list: CalendarListEntry[];
      try { list = await o.api.listCalendars(); }
      catch (e) {
        if (!(e instanceof CalendarApiError && e.code === 'scope_missing')) throw e;
        // Without the calendar-list permission only the primary calendar is available.
        list = [{calendar_id: 'primary', summary: state.connection.google_email, time_zone: null, access_role: 'owner', primary: true}];
      }
      await o.rpc('revenue_calendar_report_calendars', {...args, p_calendars: list});
      state = await o.rpc<ConnectionState>('revenue_calendar_state', args);
    }
    for (const calendar of state.calendars.filter(c => c.sync_enabled)) {
      const r = {calendar_id: calendar.calendar_id, ingested: 0, ignored: 0, skipped: 0, rejected: 0, reset: false, series: 0};
      report.calendars.push(r);
      let syncToken = calendar.sync_token, pageToken = calendar.page_token;
      const ingest = async (event: IngestEvent) => {
        try {
          const out = await o.rpc<{ignored?: string}>('revenue_calendar_ingest', {...args, p_calendar: calendar.calendar_id, p_event: event});
          if (out && typeof out === 'object' && out.ignored) r.ignored++; else r.ingested++;
        } catch (e) {
          if (!(e instanceof RevenueError && (e.status === 400 || e.status === 409))) throw e;
          r.rejected++;
        }
      };
      try {
        for (let page = 0; page < (o.maxPages ?? 10); page++) {
          let changes: Page;
          try { changes = await o.api.changes(calendar.calendar_id, syncToken, pageToken); }
          catch (e) {
            if (!(e instanceof CalendarApiError && e.code === 'sync_expired' && (syncToken || pageToken))) throw e;
            syncToken = null; pageToken = null; r.reset = true;
            changes = await o.api.changes(calendar.calendar_id, null, null);
          }
          const tz = validTimeZone(changes.timeZone) ?? calendar.time_zone, fetchedAt = new Date(now()).toISOString();
          for (const item of changes.items ?? []) {
            if (item.recurrence?.length || (item.status === 'cancelled' && !item.recurringEventId && !item.start)) {
              // Series master changed (or something was deleted): re-expand the window and cancel
              // future instances Google no longer returns. A plain deleted event has no instances.
              const from = new Date(now() - lookbackDays * 86_400_000), to = new Date(now() + horizonDays * 86_400_000);
              const keep: string[] = [];
              if (item.status !== 'cancelled') {
                const expanded = await o.api.instances(calendar.calendar_id, item.id, from, to);
                for (const instance of expanded.items.slice(0, 200)) {
                  const mapped = toIngestEvent({...instance, recurringEventId: instance.recurringEventId ?? item.id}, {calendarTz: validTimeZone(expanded.timeZone) ?? tz, now: now(), lookbackDays, fetchedAt});
                  if (!mapped) { r.skipped++; continue; }
                  if (mapped.status !== 'cancelled') keep.push(mapped.provider_event_id);
                  await ingest(mapped);
                }
              }
              if (item.status === 'cancelled') await ingest(toIngestEvent(item, {calendarTz: tz, now: now(), lookbackDays, fetchedAt})!);
              const out = await o.rpc<{cancelled: number}>('revenue_calendar_series', {...args, p_calendar: calendar.calendar_id, p_series: item.id, p_keep: keep, p_from: from.toISOString(), p_to: to.toISOString()});
              r.series += out?.cancelled ?? 0;
              continue;
            }
            const mapped = toIngestEvent(item, {calendarTz: tz, now: now(), lookbackDays, fetchedAt});
            if (!mapped) { r.skipped++; continue; }
            await ingest(mapped);
          }
          if (changes.nextPageToken) { pageToken = changes.nextPageToken; continue; }
          syncToken = changes.nextSyncToken ?? syncToken; pageToken = null;
          break;
        }
        await o.rpc('revenue_calendar_report', {...args, p_calendar: calendar.calendar_id, p_report: {status: 'healthy', sync_token: syncToken, page_token: pageToken, reset: r.reset, events_synced: r.ingested}});
      } catch (e) {
        const kind = statusOf(e);
        if (kind !== 'error' || !(e instanceof CalendarApiError)) throw e;
        // A temporary failure on one calendar does not stop the others.
        Object.assign(r, {error: e.message});
        await o.rpc('revenue_calendar_report', {...args, p_calendar: calendar.calendar_id, p_report: {status: 'error', error: e.message}});
        report.status = 'error'; report.error = e.message;
      }
    }
    await o.rpc('revenue_calendar_report', {...args, p_calendar: null, p_report: report.status === 'healthy' ? {status: 'healthy'} : {status: 'error', error: report.error}});
    return report;
  } catch (e) {
    const status = statusOf(e), message = e instanceof Error ? e.message : 'Calendar sync failed unexpectedly.';
    if (status !== 'unlinked') await o.rpc('revenue_calendar_report', {...args, p_calendar: null, p_report: {status, error: message}}).catch(() => undefined);
    return {...report, status, error: message};
  }
}
