# Onixus revenue system — integration status

**Nothing in Phase 1 has run against a real provider.** No Gmail, Stripe or calendar credentials
were available, no email was sent, no payment was taken, and the production database was only read
(schema and row counts during the assessment). Everything below marked "harness" ran against a
local Postgres 16 database, a fake Gmail API and Stripe events signed with a local secret.

## What ran where

| Part | Real code exercised | Provider side | Verified by |
|---|---|---|---|
| Database schema, RLS, RPCs | All three migrations, applied twice | Local Postgres 16 only | `supabase/tests/revenue-isolation.sql`, E2E suite |
| Website form intake | `handleFormSubmission` → `revenue_ingest_form` | Harness (direct handler call) | E2E step 1, negative tests |
| Gmail send | `gmailProvider` (real HTTP adapter: OAuth refresh, `messages.send`, `rfc822msgid:` lookup) | Fake Gmail API (`test/helpers/fake-gmail.ts`) that only accepts controlled recipients | E2E steps 3, 5, 9; retry/crash/dead-letter tests |
| Gmail sync | `syncMailbox` with the same adapter (history API, pagination, expired cursor fallback) | Fake Gmail API | E2E step 4; expired-connection and history-expiry tests |
| Job engine | `runWorker` → `revenue_worker_claim/complete` | Local Postgres | E2E steps 2–9; negative tests |
| Stripe Checkout | `createCheckoutSession` request shape (idempotency key, metadata) | Fake fetcher — no request reached Stripe | E2E step 7 |
| Stripe webhooks | `verifyStripeSignature` + `handleStripeWebhook` → `revenue_ingest_payment_event` | Events signed locally with a test secret | E2E step 8; forged/stale/duplicate/out-of-order/refund/cross-workspace tests |
| Onyx context for Chat | `onyxCustomerContext` over `revenue_customer_context` under the caller's role | n/a | E2E step 10 (function level) |
| Revenue UI | `/revenue` components with sample data | n/a | Browser checks on `/revenue/preview` (screenshots, keyboard, themes, mobile) |

Not exercised by any automated test:

- The HTTP routes under `app/api/revenue/*` themselves (they are thin wrappers over the tested
  handlers and RPCs; covered only by type-checking and `next build`).
- The Chat wiring in `lib/crm/server.ts` (`crmContext` now adds the revenue context). The context
  builder it calls is tested; the route needs a real Supabase session.
- `revenue_ingest_calendar_event`: the RPC exists, but there is no calendar adapter and no test.
  Meetings in the E2E suite are booked with `revenue_book_meeting`.
- The UI against live data. It was only rendered with the labelled sample data in preview mode.

## Known gap before production sending: the Mail-side sender and sync loop

Gmail refresh tokens are sealed inside the separate Onixus Mail service (`Onixus-AI/Veltra-Mail`)
and the web app deliberately has no access to them. So in production:

- `/api/revenue/worker` claims with `p_send=false`. It runs internal jobs (acknowledgement and
  follow-up drafts, onboarding checklists) and **leaves `mail.send` jobs queued**.
- An approved message therefore stays **Queued** until a sender exists. The UI says "Queued —
  waiting for the sending worker. Not sent yet", which is accurate.
- Inbound mail only reaches the revenue timeline once something calls `revenue_ingest_mail_event`.

The follow-up is a small loop inside the Mail service that reuses this branch's code paths:
`gmailProvider` + `runWorker(workerDeps(store, REVENUE_WORKER_TOKEN, …, providerFor))` for sending,
and `syncMailbox` + `mailIngester` for inbound. It needs a change in the Mail repository, which
this branch does not touch.

## Credentials needed to go live (names only; none were created or changed)

| For | What | Where |
|---|---|---|
| Real Gmail | Nothing new on the web side. The Mail service already holds the Google OAuth client and tokens; it needs the sender/sync loop above plus a `REVENUE_WORKER_TOKEN`. | Onixus Mail (Railway) |
| Stripe Checkout | `STRIPE_RESTRICTED_KEY` (Checkout Sessions write). Confirm which Stripe account customer payments should use — the same name is used for Onixus credit billing today. | Web (Vercel) |
| Stripe webhooks | `STRIPE_WEBHOOK_SECRET`, `REVENUE_STRIPE_INTEGRATION_ID`, `REVENUE_STRIPE_INTEGRATION_TOKEN`, plus a webhook endpoint in the Stripe dashboard (test mode first) | Web (Vercel) + Stripe |
| Worker | `REVENUE_WORKER_TOKEN`, `CRON_SECRET`, and a cron entry | Web (Vercel) |
| Calendar | Not built: needs a Google Calendar scope and an adapter | Phase 2 |

## Claims deliberately not made

- **No delivery claims.** Gmail's acceptance is shown as "Accepted by provider". "Delivered"
  appears only on an explicit provider signal, and Gmail provides none for normal sends, so
  production will rarely show it. Opens are recorded as events and never counted as reads.
- **No performance budgets.** The harness runs the whole E2E suite in about 0.6 s on a laptop-sized
  VM, but nothing has been load-tested. No latency or throughput targets are claimed.
- **No live reply-rate or revenue numbers.** The overview reports "Unknown" (not zero) for payments
  until a payment integration is active.
- **Acceptance steps 1–11** follow my reading of the brief's journey (prospect → reply →
  opportunity → meeting → proposal → payment → onboarding → memory → overview). The brief's exact
  step wording was not available when the tests were written.
