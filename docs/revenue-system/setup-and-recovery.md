# Onixus revenue system — setup and recovery

Nothing in this branch has been applied to production. Every step below that touches the
production database, environment variables or provider dashboards needs an owner's explicit
go-ahead and should be done in the order given.

## 0. Go-live checklist (who does what, in order)

| # | Step | Who | Reversible by |
|---|---|---|---|
| 1 | Merge Veltra-Model-1 #92, then the stacked live-gaps PR. Do not merge Veltra-Mail#39 yet. | Repository owner | Revert |
| 2 | Point-in-time backup; apply the four migrations in order (section 1) | Database owner | Restore / drop (section 1) |
| 3 | Read-only checks after the migration: `select count(*) from public.revenue_events;` returns 0; `anon` cannot `select` from `revenue_messages` or `revenue_calendar_sync_state` | Database owner | n/a |
| 4 | Generate the worker token and insert its hash (section 2); set `REVENUE_WORKER_TOKEN` and `CRON_SECRET` on the web project | Vercel project owner | Unset; delete the hash row |
| 5 | Add the cron (`/api/revenue/worker`, every 5 minutes) to `apps/web/vercel.json`. It runs internal jobs only; it never sends. | Repository owner (deploy change) | Remove the entry |
| 6 | Merge Veltra-Mail#39 (flags default off; deploying it changes nothing) | Repository owner | Revert |
| 7 | On the canonical Mail deployment only: `REVENUE_RELAY=true` | Railway project owner | `REVENUE_RELAY=false` |
| 8 | Live check: approve one message to an address you control. Expect "Accepted by Gmail" within a minute, then reply and expect it on the timeline with the follow-up stopped. Pause all automation first if anything looks wrong. | Workspace owner | Pause all automation |
| 9 | Stripe: test-mode webhook endpoint, then `STRIPE_WEBHOOK_SECRET`, `REVENUE_STRIPE_INTEGRATION_ID`, `REVENUE_STRIPE_INTEGRATION_TOKEN`, `STRIPE_RESTRICTED_KEY` (section 3) | Stripe + Vercel owner | Disable the endpoint; unset the variables |
| 10 | Calendar, per-user connections: follow [google-calendar.md](google-calendar.md) (migration `20261026150000`, Google Cloud steps, `WORKSPACE_CALENDAR_SYNC=true`). Mailbox calendar relay (optional, older path): enable the Google Calendar API, add `https://www.googleapis.com/auth/calendar.events.readonly` to the OAuth consent screen (sensitive; re-verification may apply), then on Mail `GOOGLE_CALENDAR_SCOPE=true` and `REVENUE_CALENDAR=true`; mailbox owners reconnect Google | Google Cloud owner, then Railway owner | Flags back to `false` |

Nothing is sent until a person approves a message, so step 7 alone sends nothing. Do step 8 in a workspace marked `environment = 'test'`, and leave steps 9–10 until it has been watched.

## 1. Apply the migrations

Files, in order:

1. `supabase/migrations/20261025090000_revenue_core_records.sql`
2. `supabase/migrations/20261025090100_revenue_mail_automation.sql`
3. `supabase/migrations/20261025090200_revenue_journey.sql`
4. `supabase/migrations/20261025120000_revenue_live_relay.sql`: the relay RPCs for Onixus Mail and
   calendar ingestion. It adds one new table (`revenue_calendar_sync_state`) and replaces revenue
   functions from files 2–3. It does not alter existing tables or rows.
5. `supabase/migrations/20261026120000_revenue_reply_threading.sql`: reply threading. Adds two
   nullable columns (`message_id_header`, `references_header`) with checks that allow `null` to
   `revenue_messages`, and replaces `revenue_ingest_mail_event`, `revenue_private.lease_send` and
   `revenue_private.complete_job`. Apply it before deploying the Mail release that sends the new
   fields; the old Mail release keeps working against it. Read-only check afterwards: both
   columns exist and `select count(*) from public.revenue_messages where message_id_header is not
   null` is 0 until new mail is synced. Rollback: re-run file 4 and the `revenue_ingest_mail_event`
   definition from file 2; the columns can stay.

What they do to existing tables (everything else is new tables, functions and policies):

| Table | Change | Production impact |
|---|---|---|
| `crm_workspaces` | adds `environment text not null default 'production'` + check | Metadata-only on Postgres 11+. Existing workspaces count as production until an owner marks demo/test ones. |
| `crm_customers` (~63k rows) | adds 5 nullable columns; 3 expression indexes (canonical email, phone, name+company) | Columns are metadata-only. `create index` takes a write lock while it builds — seconds at this size. For zero lock time, create the three indexes `concurrently` by hand first; the migration then skips them (`if not exists`). |
| `crm_deals` (0 rows when assessed) | adds nullable columns; replaces `crm_deals_stage_check` with a trigger that accepts the workspace's configured stages | The default stages equal the old CHECK list (`new, qualified, meeting, proposal, won, lost`), so existing CRM code keeps working. If an owner configures custom stages, the older CRM screens (which hard-code the six keys) get a clear 400 for removed keys. |
| `crm_tasks`, `crm_memories`, `crm_mail_threads` | nullable columns + checks that allow `null` | No rewrite; existing rows remain valid. |

No existing row is updated or deleted. The migrations are re-runnable (CI applies them twice).

Recommended rollout:

1. Take a point-in-time backup (Supabase dashboard → Database → Backups) and note the time.
2. Optionally create the three `crm_customers` indexes `concurrently`.
3. Apply the four files in order in a single maintenance window (`supabase db push` from a
   checkout of this branch, or the SQL editor, one file at a time).
4. Run `supabase/tests/revenue-isolation.sql` **only against a disposable database** — it creates
   fixture users. In production, verify instead with read-only queries: `select count(*) from
   public.revenue_events;` (0) and that `anon` cannot `select` from `revenue_messages` or
   `revenue_calendar_sync_state`.

Rollback: the new objects are additive. To back out, drop the `revenue_*` tables/functions and the
`revenue_private` schema (file 4's functions and `revenue_calendar_sync_state` go with them), drop trigger `revenue_deal_stage` and restore the original
`crm_deals_stage_check`. The added nullable columns can stay.

## 2. Create integrations and tokens

All tokens are generated once, shown once, and stored only as SHA-256 hashes.

- **Website form / Stripe / calendar (booking tool) integration** — an owner calls
  `POST /api/revenue/integrations` with `{workspace_id, provider, label}` while signed in (there is
  no screen for this yet). The response contains `integration_id` and a one-time `token`.
- **Worker token** — not exposed over HTTP. An operator inserts its hash directly:

  ```sql
  insert into revenue_private.worker_tokens(token_hash,label)
  values (encode(sha256(convert_to('<token, at least 40 chars>','UTF8')),'hex'), 'web cron');
  ```

  Generate the token locally (`openssl rand -hex 32`) and never paste it into tickets or chat.
- **Onixus Mail relay**: no new token. Mail uses the CRM link token created when an owner links a
  mailbox to the workspace. Unlinking revokes it.

Booking tools post events to `POST /api/revenue/calendar/<integration_id>` with
`Authorization: Bearer <token>`. The body is one event or `{events: [...]}` (up to 100). Each event
needs `provider_event_id`, `updated_at`, `starts_at` and `ends_at`. Optional fields: `title`,
`status` (`confirmed`, `tentative` or `cancelled`), `organizer_email`, `attendees: [{email, name}]`
and `provider` (`booking_form` by default). Attendees are matched to customers, or created as new
customers. Repeats with the same or an older `updated_at` are ignored.

## 3. Environment variables (web app, names only)

| Name | Used by | Notes |
|---|---|---|
| `STRIPE_WEBHOOK_SECRET` | `/api/revenue/webhooks/stripe` | The endpoint's signing secret from Stripe. Without it the endpoint answers 503 and stores nothing. |
| `REVENUE_STRIPE_INTEGRATION_ID`, `REVENUE_STRIPE_INTEGRATION_TOKEN` | same | From step 2 (provider `stripe`). The database rejects events whose proposal belongs to another workspace. |
| `STRIPE_RESTRICTED_KEY` | `POST /api/revenue/checkout` | Restricted key with Checkout Sessions write only. This name is already used for Onixus credit billing; if customer payments should use a different Stripe account, give it a new name before enabling. |
| `REVENUE_WORKER_TOKEN` | `/api/revenue/worker` | From step 2. |
| `CRON_SECRET` | `/api/revenue/worker` | Vercel sends it as `Authorization: Bearer …` for cron calls; must be ≥ 32 characters. |

No cron schedule is committed. To run the internal worker every 5 minutes, add to
`apps/web/vercel.json` (a deploy configuration change — needs approval):

```json
{"crons": [{"path": "/api/revenue/worker", "schedule": "*/5 * * * *"}]}
```

Stripe dashboard: add a webhook endpoint `https://<web host>/api/revenue/webhooks/stripe` for
`checkout.session.completed`, `checkout.session.async_payment_succeeded`,
`checkout.session.async_payment_failed`, `checkout.session.expired`, `payment_intent.succeeded`,
`payment_intent.payment_failed`, `payment_intent.canceled`, `charge.refunded`. Other types are
acknowledged and ignored.
Use test mode first.

Website forms post JSON to `/api/revenue/forms/<integration_id>` with header
`X-Onixus-Form-Token: <token>` and fields `submission_id`, `email` or `phone`, `name`, `company`,
`subject`, `message`, optional `utm` (≤ 8 keys). Leave the hidden honeypot field
`website_url_confirm` empty.

Onixus Mail settings for the relay (Veltra-Mail#39, all default off): `REVENUE_RELAY`,
`REVENUE_RELAY_SECONDS` (60), `REVENUE_CALENDAR`, `GOOGLE_CALENDAR_SCOPE`. See that repository's
`docs/revenue-relay.md`.

## 4. Recovery

| Symptom (shown in `/revenue`) | Cause | Recovery |
|---|---|---|
| Mail sync **expired** | Google revoked or expired the refresh token | Reconnect Google in Onixus Mail. The next sync resumes from the stored cursor; nothing is marked sent meanwhile. |
| Mail sync **error**, history cursor too old | Gmail history older than ~7 days | Automatic: the sync falls back to a recent-mail scan and re-records the cursor. Duplicates are ignored by provider message id. |
| Message **failed** (bounce) | Address rejected | Address is suppressed automatically. Verify it; an owner can unsuppress with a reason. |
| Message **failed** (other) | Provider error after retries | Fix the cause, then **Retry** on the message. The worker checks the provider for an already-sent copy before resending. |
| Job **dead** | Permanent failure or max attempts | Read the error in Automation → Run history, fix, then **Replay**. |
| Many sends queued, none leaving | Workspace paused, daily send limit reached, Mail relay off (`REVENUE_RELAY`), or the Google connection expired | Automation shows the pause reason and limits; the overview shows mail connection health. |
| Priority **"send_unassigned"** | Several mailboxes are linked and a message has no sending mailbox | Give the workspace's sender identity a mailbox (its `account_id`), draft the message from that mailbox's thread, or unlink unused mailboxes. |
| Message **failed**: sender not allowed | The From address is not the mailbox or a verified Gmail send-as alias | Use the mailbox address, or verify the alias in Gmail, then **Retry**. |
| Calendar **missing access** | Calendar scope not granted (or `GOOGLE_CALENDAR_SCOPE` off) | Add the scope to the consent screen if not done, then reconnect Google in Onixus Mail and allow Calendar. |
| Calendar **error**: API not enabled | Calendar API disabled in the Google Cloud project | Enable the Google Calendar API; the next pass recovers. |
| Calendar **expired** | Google access revoked | Reconnect Google in Onixus Mail. A full calendar resync runs automatically; duplicates are ignored. |
| Meeting linked to the wrong record, or not linked | Ambiguous attendee, or several open opportunities | Resolve the identity review; link the opportunity by hand. Unknown attendees are never created from invites. |
| Relay log: "CRM link … revoked or replaced" | Mail was unlinked or relinked | Relink Mail to the workspace. |
| Recipient sees a reply as a new conversation | No message in that thread has a stored `Message-ID` (synced before the reply-threading migration, or the sender omitted it). The reply still went into the Gmail thread. | None needed. The next message synced in the thread is stored with its id, and later replies carry `In-Reply-To` and `References`. Check `message_id_header` on the thread's messages. |
| Webhook 400 "signature" | Wrong `STRIPE_WEBHOOK_SECRET` or clock skew > 5 min | Correct the secret; Stripe retries for 3 days, and duplicates are ignored by event id. |
| Payment confirmed but onboarding **on hold** | Refund brought the paid amount below the proposal rule | Resolve with the customer; a further qualifying payment resumes onboarding automatically. |
| Customer flagged **identity review** | Ambiguous match (several emails, phone or name+company) | Identity reviews → merge or mark different. Merges can be undone from the same page. |
| Emergency stop | Anything sending unexpectedly | Automation → **Pause all automation** (owner). Jobs stay queued; nothing is lost. |

## 5. Hermetic test harness (no providers, no production)

```bash
# Disposable Postgres 16 (CI uses the same image)
docker run -d --name rev-pg -e POSTGRES_PASSWORD=fixture-only-password -p 5432:5432 postgres:16
export PGHOST=127.0.0.1 PGUSER=postgres PGPASSWORD=fixture-only-password
psql -d postgres -c 'create database rev'
for f in supabase/tests/revenue-bootstrap.sql supabase/migrations/20261025*_revenue_*.sql supabase/migrations/20261026030000_crm_prospect_scores.sql supabase/migrations/20261026120000_revenue_reply_threading.sql; do psql -v ON_ERROR_STOP=1 -qd rev -f "$f"; done
psql -v ON_ERROR_STOP=1 -qd rev -f supabase/tests/revenue-isolation.sql   # "revenue isolation tests passed"
psql -v ON_ERROR_STOP=1 -qd rev -f supabase/tests/revenue-threading.sql   # "revenue threading tests passed"

cd apps/web
npx tsx --test test/*.test.ts                                              # unit tests
REVENUE_TEST_DATABASE_URL=postgres://postgres:fixture-only-password@127.0.0.1:5432/rev \
  npx tsx --test --test-concurrency=1 test/revenue-e2e/acceptance.test.ts  # E2E (27 tests)

# HTTP route and Chat wiring tests need a PostgREST binary (CI pins v12.2.3 by sha256)
curl -fsSL -o /tmp/postgrest.tar.xz https://github.com/PostgREST/postgrest/releases/download/v12.2.3/postgrest-v12.2.3-linux-static-x64.tar.xz
echo "9f71269e61ac3a940281e93ff415760f5957e430e475ba4c3889f3ede7d5527c  /tmp/postgrest.tar.xz" | sha256sum -c - && tar -xJf /tmp/postgrest.tar.xz -C /tmp
REVENUE_TEST_DATABASE_URL=postgres://postgres:fixture-only-password@127.0.0.1:5432/rev REVENUE_TEST_POSTGREST_BIN=/tmp/postgrest \
  npx tsx --test --test-concurrency=1 test/revenue-e2e/routes.test.ts test/revenue-e2e/chat.test.ts
```

The route and Chat tests create a local `authenticator` role, start PostgREST against the
disposable database, and answer Supabase Auth's `/auth/v1/user` with a local JWT check. Every other
network call fails the test, so no request can leave the machine.

The harness store refuses any database URL that is not on localhost. The fake Gmail API only
accepts controlled recipients; Stripe events are signed with a local secret and go through the
real verification code. `/revenue/preview` shows the UI with clearly labelled sample data and
refuses every write.
