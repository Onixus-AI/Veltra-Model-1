// In-memory Google Calendar API (events.list with syncToken/pageToken, 410 for expired tokens,
// 403 for a token without the calendar scope) served through a fetch function, so the real
// googleCalendarProvider adapter and syncCalendar loop run on top of it.

type Attendee = {email: string; displayName?: string; self?: boolean; resource?: boolean; organizer?: boolean; responseStatus?: string};
export type FakeEvent = {id: string; status: 'confirmed' | 'tentative' | 'cancelled'; summary?: string; start?: {dateTime?: string; date?: string}; end?: {dateTime?: string; date?: string};
  updated: string; organizer?: {email: string; self?: boolean}; attendees?: Attendee[]; recurrence?: string[]; recurringEventId?: string};

export function fakeCalendar(o: {mailbox: string; pageSize?: number}) {
  const events = new Map<string, FakeEvent>();
  const log: {seq: number; id: string; snapshot: FakeEvent}[] = [];
  let seq = 0, clock = Date.now() - 60_000, revoked = false, scopeMissing = false, minToken = 0, apiDisabled = false;
  const queued: FakeEvent[][] = [];
  const calls: string[] = [];
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
  const tick = () => new Date(clock += 1000).toISOString();

  const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    calls.push(`${init?.method ?? 'GET'} ${url.pathname}${url.search}`);
    if (url.host === 'oauth.fake') return revoked ? json(400, {error: 'invalid_grant'}) : json(200, {access_token: 'fake-calendar-access', expires_in: 3600});
    if (url.host !== 'calendar.fake') throw new Error(`unexpected host ${url.host}`);
    if (revoked) return json(401, {error: {message: 'Invalid Credentials'}});
    if (scopeMissing) return json(403, {error: {message: 'Request had insufficient authentication scopes.', errors: [{reason: 'insufficientPermissions'}]}});
    if (apiDisabled) return json(403, {error: {message: 'Google Calendar API has not been used in project 1 before or it is disabled.', errors: [{reason: 'accessNotConfigured'}]}});
    const m = /^\/calendar\/v3\/calendars\/([^/]+)\/events$/.exec(url.pathname);
    if (!m) return json(404, {error: {message: 'Not Found'}});
    const size = o.pageSize ?? 250;
    const syncToken = url.searchParams.get('syncToken'), pageToken = url.searchParams.get('pageToken');
    // Page tokens encode "mode:changes after seq X:offset Y"; sync tokens encode "changes after seq X".
    let full = !syncToken, after = 0, offset = 0;
    if (pageToken) { const [mode, a, b] = pageToken.split(':'); full = mode === 'full'; after = Number(a); offset = Number(b); }
    else if (syncToken) {
      after = Number(syncToken.replace('sync-', ''));
      if (after < minToken) return json(410, {error: {message: 'Sync token is no longer valid, a full sync is required.', errors: [{reason: 'fullSyncRequired'}]}});
    }
    const injected = queued.shift();
    let items: FakeEvent[];
    if (injected) items = injected;
    else if (full) items = [...events.values()].filter(e => e.status !== 'cancelled');
    else {
      const latest = new Map<string, FakeEvent>();
      for (const entry of log) if (entry.seq > after) latest.set(entry.id, entry.snapshot);
      items = [...latest.values()].map(e => (e.status === 'cancelled' ? {id: e.id, status: 'cancelled' as const, updated: e.updated} : e));
    }
    const page = items.slice(offset, offset + size);
    const more = offset + size < items.length;
    return json(200, {items: page, ...(more ? {nextPageToken: `${full ? 'full' : 'inc'}:${after}:${offset + size}`} : {nextSyncToken: `sync-${seq}`})});
  };

  const save = (e: FakeEvent) => {
    events.set(e.id, e);
    log.push({seq: ++seq, id: e.id, snapshot: structuredClone(e)});
    return e;
  };
  const me = {email: o.mailbox, self: true, organizer: true, responseStatus: 'accepted'};

  return {
    fetcher: fetcher as typeof fetch,
    options: {fetcher: fetcher as typeof fetch, apiUrl: 'https://calendar.fake/calendar/v3', tokenUrl: 'https://oauth.fake/token'},
    credentials: {clientId: 'fake-client', clientSecret: 'fake-secret', refreshToken: 'fake-refresh'},
    calls,
    /** The mailbox owner books a meeting with these guests. */
    book(id: string, guests: {email: string; name?: string}[], at: Date, o2: {title?: string; minutes?: number; organizer?: string} = {}) {
      const end = new Date(at.getTime() + (o2.minutes ?? 30) * 60_000);
      const organizer = o2.organizer ? {email: o2.organizer} : {email: o.mailbox, self: true};
      return save({id, status: 'confirmed', summary: o2.title ?? 'Discovery call', start: {dateTime: at.toISOString()}, end: {dateTime: end.toISOString()}, updated: tick(), organizer,
        attendees: [...(o2.organizer ? [{email: o2.organizer, organizer: true, responseStatus: 'accepted'}, {...me, organizer: false}] : [me]),
          ...guests.filter(g => g.email !== o2.organizer).map(g => ({email: g.email, displayName: g.name, responseStatus: 'needsAction'}))]});
    },
    move(id: string, at: Date, minutes = 30) {
      const e = structuredClone(events.get(id)!);
      e.start = {dateTime: at.toISOString()}; e.end = {dateTime: new Date(at.getTime() + minutes * 60_000).toISOString()}; e.updated = tick();
      return save(e);
    },
    cancel(id: string) {
      const e = structuredClone(events.get(id)!);
      e.status = 'cancelled'; e.updated = tick();
      return save(e);
    },
    add(e: Omit<FakeEvent, 'updated'> & {updated?: string}) { return save({...e, updated: e.updated ?? tick()}); },
    snapshot(id: string) { return structuredClone(events.get(id)!); },
    /** The next events.list response returns exactly these items (duplicates, stale copies, out of order). */
    deliverNext(items: FakeEvent[]) { queued.push(items); },
    revoke() { revoked = true; },
    reconnect() { revoked = false; },
    removeScope() { scopeMissing = true; },
    grantScope() { scopeMissing = false; },
    disableApi(v = true) { apiDisabled = v; },
    expireSyncTokens() { minToken = seq + 1; },
  };
}
