# Onixus revenue system — setup and recovery

Nothing in this branch has been applied to production. Every step below that touches the
production database, environment variables or provider dashboards needs an owner's explicit
go-ahead and should be done in the order given.

## 1. Apply the migrations

Files, in order:

1. `supabase/migrations/20261025090000_revenue_core_records.sql`
2. `supabase/migrations/20261025090100_revenue_mail_automation.sql`
3. `supabase/migrations/20261025090200_revenue_journey.sql`

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
3. Apply the three files in order in a single maintenance window (`supabase db push` from a
   checkout of this branch, or the SQL editor, one file at a time).
4. Run `supabase/tests/revenue-isolation.sql` **only against a disposable database** — it creates
   fixture users. In production, verify instead with read-only queries: `select count(*) from
   public.revenue_events;` (0) and that `anon` cannot `select` from `revenue_messages`.

Rollback: the new objects are additive. To back out, drop the `revenue_*` tables/functions and the
`revenue_private` schema, drop trigger `revenue_deal_stage` and restore the original
`crm_deals_stage_check`. The added nullable columns can stay.

## 2. Create integrations and tokens

All tokens are generated once, shown once, and stored only as SHA-256 hashes.

- **Website form / Stripe / calendar integration** — an owner calls
  `POST /api/revenue/integrations` with `{workspace_id, provider, label}` while signed in (there is
  no screen for this yet). The response contains `integration_id` and a one-time `token`.
- **Worker token** — not exposed over HTTP. An operator inserts its hash directly:

  ```sql
  insert into revenue_private.worker_tokens(token_hash,label)
  values (encode(sha256(convert_to('<token, at least 40 chars>','UTF8')),'hex'), 'web cron');
  ```

  Generate the token locally (`openssl rand -hex 32`) and never paste it into tickets or chat.

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

## 4. Recovery

| Symptom (shown in `/revenue`) | Cause | Recovery |
|---|---|---|
| Mail sync **expired** | Google revoked or expired the refresh token | Reconnect Google in Onixus Mail. The next sync resumes from the stored cursor; nothing is marked sent meanwhile. |
| Mail sync **error**, history cursor too old | Gmail history older than ~7 days | Automatic: the sync falls back to a recent-mail scan and re-records the cursor. Duplicates are ignored by provider message id. |
| Message **failed** (bounce) | Address rejected | Address is suppressed automatically. Verify it; an owner can unsuppress with a reason. |
| Message **failed** (other) | Provider error after retries | Fix the cause, then **Retry** on the message. The worker checks the provider for an already-sent copy before resending. |
| Job **dead** | Permanent failure or max attempts | Read the error in Automation → Run history, fix, then **Replay**. |
| Many sends queued, none leaving | Workspace paused, daily send limit reached, or no Mail-side sender running | Automation shows the pause reason and limits. See `integration-status.md` for the sender. |
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
for f in supabase/tests/revenue-bootstrap.sql supabase/migrations/2026102509*.sql; do psql -v ON_ERROR_STOP=1 -qd rev -f "$f"; done
psql -v ON_ERROR_STOP=1 -qd rev -f supabase/tests/revenue-isolation.sql   # "revenue isolation tests passed"

cd apps/web
npx tsx --test test/*.test.ts                                              # unit tests
REVENUE_TEST_DATABASE_URL=postgres://postgres:fixture-only-password@127.0.0.1:5432/rev \
  npx tsx --test --test-concurrency=1 test/revenue-e2e/acceptance.test.ts  # E2E
```

The harness store refuses any database URL that is not on localhost. The fake Gmail API only
accepts controlled recipients; Stripe events are signed with a local secret and go through the
real verification code. `/revenue/preview` shows the UI with clearly labelled sample data and
refuses every write.
