# Onixus revenue system: integration status

**Nothing has run against a real provider.** No Gmail, Google Calendar or Stripe credentials were
used. No email was sent, no payment was taken, and the production database was only read (schema
and row counts during the assessment).

Everything below ran against one of these:
- a local Postgres 16 database;
- a local PostgREST v12.2.3 (the server Supabase uses);
- in-memory Gmail and Google Calendar APIs;
- Stripe events signed with a local secret;
- a fake model gateway.

Two branches make up the work:

| Repository | Branch / PR | Contents |
|---|---|---|
| Veltra-Model-1 (web) | `cursor/onixus-revenue-phase1-ca74`, PR #92 | Phase 1: records, automation, journey, UI. |
| Veltra-Model-1 (web) | `cursor/onixus-revenue-live-gaps-ca74`, stacked on #92 | Relay RPCs, calendar ingestion, route and Chat tests. This file. |
| Veltra-Mail | `cursor/revenue-relay-ca74`, PR Veltra-Mail#39 | The Gmail and Calendar relay inside Onixus Mail. |

Merge order: #92, then the stacked web PR, then Veltra-Mail#39 (only after the migration is applied).

## What ran where

| Part | Real code exercised | Provider side | Verified by |
|---|---|---|---|
| Database schema, RLS, RPCs | All revenue migrations, each applied twice | Local Postgres 16 only | `supabase/tests/revenue-isolation.sql`, `supabase/tests/revenue-threading.sql`, E2E suite |
| HTTP routes `app/api/revenue/*` | The unmodified Next.js handlers, through supabase-js and a real PostgREST | Local PostgREST. Supabase Auth's `/auth/v1/user` is replaced by a local HS256 check of the same JWTs PostgREST verifies | `test/revenue-e2e/routes.test.ts` |
| Chat wiring | `/api/chat`, `/api/crm/assistant`, `/api/crm/context/*`, `crmContext`, `runCrmChat`, `crmPlanner` | Local PostgREST; fake model gateway | `test/revenue-e2e/chat.test.ts` |
| Website form intake | `handleFormSubmission` → `revenue_ingest_form` | Direct handler call, plus a route test | E2E step 1, negatives, route test |
| Gmail send | `relayAccount` → `revenue_mail_claim` / `revenue_mail_complete` with the mailbox's CRM link token; `gmailProvider` (OAuth refresh, `messages.send`, `settings/sendAs`, `rfc822msgid:` lookup) | Fake Gmail API that only accepts controlled recipients | E2E steps 3 and 5; revoked-token, retry/crash, sender and bounce negatives; Veltra-Mail#39 tests |
| Gmail sync | `syncMailbox` inside the relay (history API, pagination, expired-cursor fallback) → `revenue_ingest_mail_event` | Fake Gmail API | E2E step 4; history-expiry and revoked-token negatives |
| Google Calendar | `googleCalendarProvider` + `syncCalendar` inside the relay → `revenue_mail_calendar_event` / `revenue_mail_calendar_status` | Fake Calendar API (sync tokens, 410, 403 scope, 403 API disabled) | E2E step 6; four calendar negatives; Veltra-Mail#39 tests |
| Calendar endpoint for booking tools | `POST /api/revenue/calendar/<integration>` → `revenue_ingest_calendar_event` | Direct handler call and route test | "calendar endpoint" test, route test |
| Internal job engine (web cron) | `runWorker` → `revenue_worker_claim/complete` with `p_send=false` | Local Postgres | E2E steps 2 and 7–9; route test (`sent=0`) |
| Stripe Checkout | `createCheckoutSession` request shape | Fake fetcher; no request reached Stripe | E2E step 7 |
| Stripe webhooks | `verifyStripeSignature` + `handleStripeWebhook` | Events signed locally | E2E step 8; payment negatives; route test (503 unconfigured, 400 bad signature) |
| Revenue UI | `/revenue` components with sample data | n/a | Browser checks on `/revenue/preview` |

The Mail relay in Veltra-Mail#39 runs the same adapter files, copied with `.js` import suffixes. Its
tests use the in-memory Gmail and Calendar plus an in-memory version of the workspace RPCs. This
repository's E2E runs the same relay code against the real database functions.

## Acceptance journey: your numbering vs the test file

Your brief's steps 5–7 are covered by these tests in `test/revenue-e2e/acceptance.test.ts`:

| Your step | Test(s) | Through |
|---|---|---|
| 5. Send and provider status | Step 3 (first message) and step 5 (in-thread reply) | `relayAccount` → `revenue_mail_claim` (account token) → `gmailProvider` → fake Gmail → `revenue_mail_complete`. The status stops at `provider_accepted`. |
| 6. Reply stops follow-ups | Step 4 | Relay sync → `revenue_ingest_mail_event` |
| 7. Meeting booked and linked | Step 6 | Fake Calendar → relay → `revenue_mail_calendar_event`. Linked to the customer and the single open opportunity; reschedule recorded. |

Negatives for the same steps:
- **Revoked token.** A revoked Google token holds sends and shows health with a recovery.
- **Bounce.** Covered by "unsubscribed and bounced contacts…".
- **Duplicate and out-of-order calendar events.** Converge to one meeting.
- **Ambiguous attendee.** Goes to identity review.
- **Calendar access.** Missing scope, a disabled API and an expired token surface as health.
- **Sender.** A sender the mailbox cannot use fails visibly.

## Boundary decision: per-mailbox CRM link token

Onixus Mail keeps the Google tokens; this app never sees them.

Mail calls the relay RPCs through PostgREST with the project's public key plus the CRM link token
it already stores for each linked mailbox. These are the same tokens `crm_ingest_mail` uses today.
Every relay RPC checks the token against `crm_mail_connections.token_hash`, so a mailbox can only:
- claim messages assigned to that mailbox. Unassigned messages are claimable only when the
  workspace has exactly one linked mailbox; otherwise the overview raises "send_unassigned";
- complete jobs it leased;
- record mail and calendar changes for its own workspace.

Mail holds no service-role key and no global worker token. Unlinking Mail in Workspace stops the
relay for that mailbox. `/api/revenue/worker` (web cron) keeps running only internal jobs and never
sends.

## Credentials and settings needed to go live (names only; none were created or changed)

| For | What | Where |
|---|---|---|
| Gmail send and sync | `REVENUE_RELAY=true` on the canonical Mail deployment. It uses Mail's existing `CHAT_SUPABASE_URL`, `CHAT_SUPABASE_PUBLIC_KEY`, `DATABASE_URL`, `SESSION_SECRET` and Google OAuth client. No new secret. | Onixus Mail (Railway) |
| Google Calendar | Google Cloud project owner: enable the Calendar API and add `https://www.googleapis.com/auth/calendar.events.readonly` to the OAuth consent screen. Then set `GOOGLE_CALENDAR_SCOPE=true` and `REVENUE_CALENDAR=true` on Mail, and have mailbox owners reconnect. | Google Cloud console + Mail |
| Booking tools (optional) | A `calendar` integration token per workspace (`POST /api/revenue/integrations`) | Web |
| Stripe Checkout | `STRIPE_RESTRICTED_KEY` (Checkout Sessions write). Confirm which Stripe account customer payments should use. | Web (Vercel) |
| Stripe webhooks | `STRIPE_WEBHOOK_SECRET`, `REVENUE_STRIPE_INTEGRATION_ID`, `REVENUE_STRIPE_INTEGRATION_TOKEN`, and a Stripe dashboard endpoint (test mode first) | Web (Vercel) + Stripe |
| Internal worker | `REVENUE_WORKER_TOKEN`, `CRON_SECRET`, and a cron entry | Web (Vercel) |

The exact order and owners are in `setup-and-recovery.md`, section 0.

## Still harness-only, or not built

- **Everything provider-facing.** Gmail, Calendar and Stripe calls have only reached in-memory
  fakes. The first real send, reply, bounce, calendar event and payment still need to be watched
  live, with addresses you control.
- **Supabase Auth.** The route and Chat tests replace `/auth/v1/user` with a local JWT check.
  PostgREST, RLS and the database functions are real.
- **Recurring calendar series.** Series are skipped as series; single meetings and changed
  occurrences are recorded. All-day events, and events that ended more than 30 days ago, are
  skipped.
- **Unknown calendar attendees** are ignored, not created, because invites are untrusted. Booking
  tools posting to the calendar endpoint do create customers.
- **Outlook mailboxes** are skipped by the relay.
- **The UI against live data.** It was rendered only with labelled sample data.

## Reply threading

Replies sent through the relay carry `In-Reply-To` and `References`, so they thread for the
recipient as well as in the sending Gmail (`threadId`). Migration
`20261026120000_revenue_reply_threading.sql` adds two nullable columns to `revenue_messages`
(`message_id_header`, `references_header`):

- Sync stores the `Message-ID`, `In-Reply-To` and `References` of every inbound message and every
  message sent from Gmail directly. A send through the relay records the `Message-ID` it carried
  (`<onixus-<message id>@onixus.mail>`).
- When Mail claims a send, the database picks the latest received or sent message in the same
  mailbox thread that has a `Message-ID`. The reply gets `In-Reply-To: <that id>`, a `References`
  chain ending with it (the thread root plus the 19 most recent ids), and a `Re:` subject.
- Only well-formed `<id@domain>` values are stored or sent. Anything else in a header value,
  including CR/LF, is dropped, both in Mail and by check constraints in the database.
- Messages synced before the migration have no stored `Message-ID`. A reply in such a thread
  still goes into the Gmail thread, without threading headers, as before. The next message in the
  thread is stored with its id. A follow-up draft's legacy `in_reply_to` (Gmail's API id, not a
  `Message-ID`) is ignored.

Verified by `supabase/tests/revenue-threading.sql`, E2E steps 3–5 and the "reply threading" E2E
test, the route test for the thread view, `test/revenue-mail.test.ts`, and the Veltra-Mail relay
tests.

## Found and fixed while testing Chat

Inbound email creates a "Reply: <subject>" task. That task title, message subjects, meeting titles
and the raw CRM records passed to the model were not inside the untrusted-content fence. They were
under a general "untrusted evidence" preamble, but a forged subject sat outside any fence. They are
now fenced (`lib/revenue/chat-context.ts`, `lib/crm/suite-domain.ts`). `chat.test.ts` checks that
every occurrence of hostile email text reaching the model is inside a fence, and that the email
body never reaches the model at all.

## Claims deliberately not made

- **No delivery claims.** Gmail's acceptance shows as "Accepted by provider". Gmail sends no
  delivery confirmation, so "Delivered" will rarely appear. Opens are never counted as reads.
- **No performance budgets.** Nothing has been load-tested.
- **No live reply-rate or revenue numbers.** The overview reports "Unknown" (not zero) until
  integrations are active.
