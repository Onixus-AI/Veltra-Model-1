import {MailProviderError} from './mail-provider';
import {googleAccessToken, type GoogleCredentials} from './google-auth';
import {RevenueError} from './errors';

// Google Calendar ingestion: events.list with a sync token for incremental changes (410 Gone means
// the token expired and a full resync starts). Events become meetings in the revenue tables; the
// database matches attendees to customers and ignores stale or duplicate updates. Event
// descriptions are never read; titles are stored as untrusted external text.

export type CalendarAttendee = {email: string; name?: string | null; self?: boolean; resource?: boolean; organizer?: boolean; response_status?: string | null};

export type CalendarEvent = {
  provider_event_id: string; status: 'confirmed' | 'tentative' | 'cancelled'; title: string | null;
  starts_at: string | null; ends_at: string | null; updated_at: string;
  organizer_email: string | null; organizer_self: boolean; attendees: CalendarAttendee[];
  mailbox?: string | null;
};

export type CalendarPage = {events: CalendarEvent[]; skipped: number; nextPageToken: string | null; nextSyncToken: string | null};

export interface CalendarProvider {
  readonly name: string;
  readonly calendarId: string;
  changes(syncToken: string | null, pageToken: string | null): Promise<CalendarPage>;
}

type GoogleEvent = {
  id: string; status?: string; summary?: string; updated?: string; recurrence?: string[]; recurringEventId?: string;
  start?: {dateTime?: string; date?: string}; end?: {dateTime?: string; date?: string};
  organizer?: {email?: string; self?: boolean};
  attendees?: {email?: string; displayName?: string; self?: boolean; resource?: boolean; organizer?: boolean; responseStatus?: string}[];
};

/**
 * Maps a Google event to the ingestion shape, or null when it is not a meeting we record:
 * recurring-series masters (their individual instances arrive separately when changed), all-day
 * entries, and events that ended before the look-back window. Cancellations are always kept.
 */
export function toCalendarEvent(e: GoogleEvent, o: {now: number; lookbackDays: number; fetchedAt: string}): CalendarEvent | null {
  const cancelled = e.status === 'cancelled';
  if (!cancelled) {
    if (e.recurrence?.length) return null;
    if (!e.start?.dateTime || !e.end?.dateTime) return null;
    if (Date.parse(e.end.dateTime) < o.now - o.lookbackDays * 86_400_000) return null;
  }
  return {
    provider_event_id: e.id, status: cancelled ? 'cancelled' : e.status === 'tentative' ? 'tentative' : 'confirmed',
    title: e.summary?.slice(0, 300) ?? null, starts_at: e.start?.dateTime ?? null, ends_at: e.end?.dateTime ?? null,
    // Incremental cancellations may carry only the id; the fetch time then orders them.
    updated_at: e.updated ?? o.fetchedAt,
    organizer_email: e.organizer?.email?.toLowerCase() ?? null, organizer_self: Boolean(e.organizer?.self),
    attendees: (e.attendees ?? []).filter(a => a.email).slice(0, 100).map(a => ({email: a.email!.toLowerCase(), name: a.displayName?.slice(0, 160) ?? null,
      self: Boolean(a.self), resource: Boolean(a.resource), organizer: Boolean(a.organizer), response_status: a.responseStatus ?? null})),
  };
}

export function googleCalendarProvider(credentials: GoogleCredentials, o: {fetcher?: typeof fetch; apiUrl?: string; tokenUrl?: string; calendarId?: string; lookbackDays?: number; now?: () => number} = {}): CalendarProvider {
  const fetcher = o.fetcher ?? fetch;
  const api = (o.apiUrl ?? 'https://www.googleapis.com/calendar/v3').replace(/\/$/, '');
  const calendarId = o.calendarId ?? 'primary';
  const token = googleAccessToken(credentials, o);

  async function call<T>(path: string): Promise<T> {
    const response = await fetcher(api + path, {headers: {Authorization: `Bearer ${await token.get()}`}, signal: AbortSignal.timeout(20000)});
    if (response.ok) return response.json() as Promise<T>;
    const detail = await response.json().catch(() => ({})) as {error?: {message?: string; errors?: {reason?: string}[]}};
    const message = detail.error?.message?.slice(0, 200) ?? `Google Calendar returned ${response.status}`;
    const reasons = (detail.error?.errors ?? []).map(x => x.reason ?? '').join(' ');
    if (response.status === 401) { token.reset(); throw new MailProviderError('auth_expired', 'Google connection expired. Reconnect Google in Onixus Mail.', false); }
    if (response.status === 410) throw new MailProviderError('cursor_expired', 'Calendar sync position expired; a full calendar resync is required.', true);
    if (response.status === 429 || (response.status === 403 && /rateLimitExceeded|userRateLimitExceeded|quota/i.test(reasons + message))) throw new MailProviderError('rate_limited', 'Google Calendar rate limit reached; retrying later.', true);
    if (response.status === 403 && /insufficientPermissions|insufficient authentication scopes|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(reasons + message))
      throw new MailProviderError('scope_missing', 'Calendar access was not granted to Onixus Mail. Reconnect Google and allow Calendar events (read-only).', false);
    if (response.status === 403 && /accessNotConfigured|has not been used|is disabled/i.test(reasons + message))
      throw new MailProviderError('provider_unavailable', 'The Google Calendar API is not enabled for the Onixus Mail Google Cloud project.', false);
    if (response.status >= 500) throw new MailProviderError('temporary', 'Google Calendar is temporarily unavailable.', true);
    throw new MailProviderError('rejected', message, false);
  }

  return {
    name: 'Google Calendar',
    calendarId,
    async changes(syncToken, pageToken) {
      const params = new URLSearchParams({maxResults: '250', singleEvents: 'false'});
      if (syncToken) params.set('syncToken', syncToken);
      if (pageToken) params.set('pageToken', pageToken);
      const fetchedAt = new Date().toISOString();
      const page = await call<{items?: GoogleEvent[]; nextPageToken?: string; nextSyncToken?: string}>(`/calendars/${encodeURIComponent(calendarId)}/events?${params}`);
      const now = o.now?.() ?? Date.now();
      const mapped = (page.items ?? []).map(e => toCalendarEvent(e, {now, lookbackDays: o.lookbackDays ?? 30, fetchedAt}));
      const events = mapped.filter((e): e is CalendarEvent => e !== null);
      return {events, skipped: mapped.length - events.length, nextPageToken: page.nextPageToken ?? null, nextSyncToken: page.nextSyncToken ?? null};
    },
  };
}

export type CalendarState = {sync_token: string | null; page_token: string | null} | null;
export type CalendarSyncResult = {status: 'healthy' | 'expired' | 'scope_missing' | 'error'; ingested: number; ignored: number; skipped: number; rejected: {provider_event_id: string; reason: string}[]; reset: boolean; error?: string};

/**
 * One calendar pass. The sync position only advances after every event in a page was accepted
 * (or permanently rejected as invalid), so a failure mid-page is retried from the same position.
 */
export async function syncCalendar(o: {provider: CalendarProvider; state: CalendarState; mailbox: string | null; maxPages?: number;
  ingest: (event: CalendarEvent) => Promise<{ignored?: string} | unknown>; status: (status: Record<string, unknown>) => Promise<unknown>}): Promise<CalendarSyncResult> {
  let syncToken = o.state?.sync_token ?? null, pageToken = o.state?.page_token ?? null, reset = false;
  let ingested = 0, ignored = 0, skipped = 0;
  const rejected: CalendarSyncResult['rejected'] = [];
  try {
    for (let page = 0; page < (o.maxPages ?? 10); page++) {
      let changes: CalendarPage;
      try {
        changes = await o.provider.changes(syncToken, pageToken);
      } catch (e) {
        if (!(e instanceof MailProviderError && e.code === 'cursor_expired' && (syncToken || pageToken))) throw e;
        syncToken = null; pageToken = null; reset = true;
        changes = await o.provider.changes(null, null);
      }
      skipped += changes.skipped;
      for (const event of changes.events) {
        try {
          const r = await o.ingest({...event, mailbox: o.mailbox});
          if (r && typeof r === 'object' && 'ignored' in r && r.ignored) ignored++; else ingested++;
        } catch (e) {
          if (!(e instanceof RevenueError && (e.status === 400 || e.status === 409))) throw e;
          rejected.push({provider_event_id: event.provider_event_id, reason: e.message});
        }
      }
      if (changes.nextPageToken) { pageToken = changes.nextPageToken; continue; }
      syncToken = changes.nextSyncToken ?? syncToken; pageToken = null;
      break;
    }
    await o.status({status: 'healthy', calendar_id: o.provider.calendarId, sync_token: syncToken, page_token: pageToken, reset, events_synced: ingested});
    return {status: 'healthy', ingested, ignored, skipped, rejected, reset};
  } catch (e) {
    const code = e instanceof MailProviderError ? e.code : 'temporary';
    const status = code === 'auth_expired' ? 'expired' : code === 'scope_missing' ? 'scope_missing' : 'error';
    const message = e instanceof MailProviderError ? e.message : 'Calendar sync failed unexpectedly.';
    await o.status({status, calendar_id: o.provider.calendarId, error: message}).catch(() => undefined);
    return {status, ingested, ignored, skipped, rejected, reset, error: message};
  }
}
