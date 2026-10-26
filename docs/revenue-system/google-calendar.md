# Google Calendar in Onixus Workspace and Onixus CRM

Each Onixus Workspace user can connect their own Google Calendar. They see their upcoming events,
create, edit and cancel events after reviewing exactly who Google will email, and meetings with
customers appear on Onixus CRM timelines. Nothing here has run against real Google yet; see
"Go-live" below.

## Where things live

| Piece | Where | Notes |
| --- | --- | --- |
| Google tokens | Onixus Mail (`Onixus-AI/Veltra-Mail`), `veltra_workspace_connections`, provider `google_calendar` | AES-256-GCM sealed with `SESSION_SECRET`, bound to user and provider. Never returned to the browser. |
| CRM link | `public.revenue_calendar_connections` (Supabase, this repo) | One row per workspace, user and provider. Holds the Google email, granted scopes, health and a sha256 of a link token. The raw link token is sealed in Mail next to the Google tokens. |
| Calendar choices and sync positions | `public.revenue_calendar_calendars` | Which calendars add meetings to the CRM, which one receives new events, `syncToken`/`pageToken`. |
| Meetings | `public.revenue_meetings` (+ nullable `calendar_connection_id`, `calendar_id`, `time_zone`, `all_day`, `start_date`, `end_date`, `recurring_event_id`, `ical_uid`) | Same table and dedupe as the existing ingestion (PR #93). |
| UI | `/settings/calendar` (`components/google-calendar.tsx`), tile on `/settings/connections` | Calls Mail through `/api/google-calendar/*` and the CRM through `/api/revenue/*`. |
| Sync | Mail background loop, `WORKSPACE_CALENDAR_SYNC=true`, every `WORKSPACE_CALENDAR_SYNC_SECONDS` (default 300, minimum 60) | Plus "Sync now" in the UI. No push notifications (they need a verified public webhook domain per channel and renewals; polling with sync tokens is cheap). |

Other Google connections are untouched:

- **Mail inbox (Gmail sign-in, e.g. info@onixus.xyz):** `GOOGLE_CLIENT_ID`, unchanged. The PR #39
  mailbox calendar relay keeps working. When a mailbox's address also has a dedicated calendar
  connection in the same workspace, `revenue_mail_calendar_event` ignores the mailbox copy
  (`dedicated_calendar_connection`), so each meeting has one source.
- **Drive, Docs and Sheets (provider `google_workspace`):** same OAuth client, separate grant. The
  calendar flow asks with `include_granted_scopes=false`, so its token only carries Calendar
  scopes and the Drive token is never replaced. Disconnecting the calendar is local only (no
  Google revoke), because revoking a token on that client can revoke the Drive grant too.
- **Onixus Admin (support@onixus.xyz in `communication_connections`):** a different Supabase
  project and code base. Not read or changed by this work.

## Scopes

Requested: `openid`, `email`, `https://www.googleapis.com/auth/calendar.events`,
`https://www.googleapis.com/auth/calendar.calendarlist.readonly`.

- `calendar.events` is required to view and to create, change and cancel events. If the person
  unticks it on Google's consent screen, nothing is saved (`?calendar=scope_missing`) and any
  existing connection keeps working.
- `calendar.calendarlist.readonly` is optional. Without it only the primary calendar is offered
  (`connected_limited`).
- The granted scopes are read from Google's token response and stored on the connection; the UI
  shows missing ones. A token that later loses a scope is reported as `scope_missing`.

## Permissions

- Connecting needs owner or member role in the CRM workspace (viewers cannot add meetings).
- Connection rows, calendar lists and settings are visible only to the user who connected them,
  through RLS and through RPCs that filter on `auth.uid()`. Workspace owners cannot see or change a
  member's calendar. `token_hash`, `pending_hash`, `sync_token` and `page_token` are not granted
  to any client role.
- Mail's link token works only for its own connection, only while the user is still an owner or
  member, and stops at disconnect or when they leave the workspace.
- Meetings follow the existing CRM model (workspace members see customer timelines). A user can
  turn off "Share meeting titles and times with my teammates": their calendar then adds no new
  meetings, while meetings already recorded still get reschedules and cancellations.
- Teammates see "A Google Calendar needs reconnecting" in priorities, never whose account it is.
- Chat cannot create or change events: `/api/google-calendar/*` refuses requests carrying
  `x-veltra-task`. A future Chat tool must return a proposal ticket and send the person to the same
  review dialog; customer-controlled strings (titles, descriptions, attendee names) stay inside the
  untrusted-content fence.

## Invitations and cancellations

1. `POST /propose` validates the draft, reads the current event (organizer only, single
   occurrences only), and returns a one-use ticket with the notification plan: `send_updates`
   (`all` or `none`), who is emailed, who is added, removed or kept, and warnings (a time that
   happens twice at a DST change, single occurrence of a series, "Google will not email anyone").
2. The review dialog lists every address Google will email. Each must be ticked.
3. `POST /commit {ticket, confirmed: true, notify_confirmed: [...]}` must name exactly the
   addresses in the plan (or none when nobody is emailed). Otherwise it returns 409
   `confirmation_required` and the ticket is spent. Updates and cancellations carry the reviewed
   ETag (`If-Match`), so a change made in Google meanwhile is refused (409 `conflict`).
4. Writes are not retried after a server error or timeout (Google may already have sent the
   invitations). Rate-limit responses are retried.

## Time zones

- Stored: UTC instant plus the event's IANA time zone; all-day events also keep `start_date` and
  the exclusive `end_date`, and their UTC range is midnight to midnight in that zone (25 hours on a
  fall-back day).
- New events are entered as wall-clock time in a chosen zone and sent with an explicit offset and
  `timeZone`. A time skipped by DST is refused; a repeated time uses the first occurrence and the
  review says so.
- CRM timeline text is written in the event's zone, e.g. `2027-03-14 10:30 America/New_York`.

## Sync

- Per calendar, incremental `events.list` with `syncToken` and `showDeleted`; on 410, a full
  resync (dedupe makes it harmless). The position advances only after the page is accepted.
- Recurring series are expanded with `events.instances` over 30 days back and 90 days ahead;
  instances Google no longer returns are cancelled once.
- 401 refreshes the access token once; `invalid_grant` is `revoked`. 429 and 5xx on reads retry
  with backoff (honouring `Retry-After`). Failures on one calendar do not stop the others. The
  connection backs off 5 minutes doubling to 6 hours; problems that need the person (expired,
  revoked, missing scope, API disabled) wait 6 hours and show Reconnect.
- Only events with a known customer as attendee are recorded. Internal addresses (workspace
  members, connected mailboxes and calendars) are not customers.

## Google Cloud configuration

All in the Google Cloud project that owns the **Workspace OAuth web client** (the one in Mail's
`WORKSPACE_GOOGLE_CLIENT_ID`, also used for Drive). Not the Gmail sign-in client
(`GOOGLE_CLIENT_ID`) and not Onixus Admin's `GOOGLE_GMAIL_CLIENT_ID`.

1. APIs & Services, Library: enable **Google Calendar API**.
2. OAuth consent screen, Data access: add
   `https://www.googleapis.com/auth/calendar.events` and
   `https://www.googleapis.com/auth/calendar.calendarlist.readonly`. Both are *sensitive* scopes:
   external production use needs Google's sensitive-scope verification (no CASA security
   assessment; that is for restricted scopes). Until verified, use Testing mode with listed test
   users (refresh tokens then expire after 7 days) or an Internal app for onixus.xyz accounts.
3. Credentials, the Workspace web client, Authorized redirect URIs: add
   `https://veltra-production-5b9c.up.railway.app/chat/google/calendar/oauth/callback`
   (in general `PUBLIC_URL/chat/google/calendar/oauth/callback`; the status endpoint shows the
   exact value).

## Go-live

1. Merge the Model-1 and Mail PRs.
2. Apply `supabase/migrations/20261026150000_revenue_calendar_connections.sql` to the Onixus
   Workspace Supabase project (additive: two tables, nullable meeting columns, replaced functions).
3. Google Cloud steps above.
4. Mail (Railway): confirm `WORKSPACE_GOOGLE_CLIENT_ID`, `WORKSPACE_GOOGLE_CLIENT_SECRET`,
   `CHAT_SUPABASE_URL` and `CHAT_SUPABASE_PUBLIC_KEY` are set; deploy; then set
   `WORKSPACE_CALENDAR_SYNC=true`. Mail's startup schema step adds `google_calendar` to the
   provider constraint without touching existing rows.
5. Deploy the web app. Open `/settings/calendar`, choose the workspace, connect, and check the
   account email shown.
6. Run the approved test event (attendees none), then cancel it with "nobody will be emailed".

Rollback: `WORKSPACE_CALENDAR_SYNC=false` stops background sync; users can disconnect; the
migration's tables can stay (nothing reads them without a connection).

## Tests

- `test/workspace-calendar.test.ts`: DST conversion, drafts, notification plans, exact
  confirmation, write retry policy, error mapping, token refresh.
- `test/google-calendar-proxy.test.ts`: route and method allowlist, Chat refusal.
- `test/google-calendar-ui.test.ts`: review dialog lists recipients and starts disabled.
- `test/revenue-e2e/calendar.test.ts` (real PostgREST, fake Google): linking and isolation,
  normalized email matching, idempotent resyncs, reschedule, rename, out-of-order and mailbox
  duplicates, 410, refresh, 429/503, per-calendar backoff, DST, all-day, recurring expansion and
  shrink, revoked, missing scope, API disabled, calendar-list fallback, cross-connection tokens.
- `supabase/tests/revenue-calendar.sql`: owner-only rows, secret columns, no direct writes,
  single-use pending token, revocation on demotion and disconnect.
- Mail `test/google-calendar.test.ts`: OAuth with PKCE and cookie-bound state, scope check,
  sealed tokens, Drive row untouched, cross-user isolation, confirmation required, one-use
  tickets, ETag conflict, organizer-only, DST refusal, disconnect, health, background pass.
