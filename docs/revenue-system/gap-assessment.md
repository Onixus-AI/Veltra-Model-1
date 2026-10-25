# Onixus revenue system — current-state gap assessment

Audit date: 2026-10-25. Scope: `Onixus-AI/Veltra-Model-1` (Onixus Workspace web app `apps/web`,
AI gateway `packages/ai-gateway`, `supabase/`), `Onixus-AI/Veltra-Mail` (Onixus Mail service on
Railway), `Onixus-AI/Veltra-CRM` (standalone CRM, Vercel project `veltra-crm`), production
Supabase project `cohmkgctiqcedkuisbqh` (read-only inspection: schema, policies, aggregate counts —
no customer rows were read), billing service branch `cursor/usage-settings-ca74`.

## 1. What exists and works (reuse)

| Capability | Where | State |
|---|---|---|
| Workspace + roles | `crm_workspaces`, `crm_memberships` (owner / member / viewer) | Live. Every CRM table has RLS keyed on membership; writes need owner/member. 2 workspaces. |
| Customer records | `crm_customers` (~62.8k rows, `record_type` company/person/influencer, `suppressed`, `identity_review_required`) | Live. Mostly OpenStreetMap discovery imports. |
| Opportunities | `crm_deals` with fixed stages `new→qualified→meeting→proposal→won/lost` | Live table, **0 rows**. Stages hard-coded in a CHECK constraint and in `lib/crm/domain.ts`. |
| Tasks | `crm_tasks` (140 rows, `action_key` idempotency) | Live. No owner, no commitment type. |
| Activity | `crm_activity` (~64k rows) + trigger `crm_private.record_activity` | Live, but almost entirely row-change noise (`insert`/`update`); 139 `email.received`, 139 `email.replied`, 44 `follow_up.sent`, 159 `service.event`. No status, source, dedupe key or related records. |
| Inquiries | `crm_inquiries` (migration `20261022100008`, CI-tested) | Live, manual entry only. No public form ingestion. |
| Mail ↔ CRM bridge | Mail outbox (`veltra_crm_outbox`) → `crm_ingest_mail` / `crm_ingest_quote_outcome` / `crm_mail_policy` RPCs authorized by `crm_mail_connections.token_hash` | Live (1 connection, 149 threads). Event receipts dedupe by event id. Matches by exact email; >1 match raises "ambiguous" and the event stays in the outbox. |
| Gmail / Outlook | `Veltra-Mail/src/mail/gmail.ts`, `outlook.ts` behind one `Mailbox` interface | Live for Gmail. Polling (`POLL_SECONDS`) using a "Handled" label — no Gmail `history`/push, no per-message delivery state. |
| Approval queue | `Veltra-Mail/src/approvals.ts` (`veltra_approvals`) | Live. Drafts need approval unless the kind is on `auto_send`. |
| Unsubscribe / bounces | `Veltra-Mail/src/unsubscribe.ts`, `delivery-feedback.ts` (DSN parsing, quarantine) | Live in Mail only; not shared with CRM suppression except `crm_suppress_mail_contact`. |
| Shared brain | `veltra_memories` (`proposed/approved`, source app/ref, revision) | Table live, 0 rows. |
| CRM memory | `crm_memories` (`proposed/approved/rejected`, expiry) | Live, 0 rows. |
| Chat ↔ CRM | `lib/crm/server.ts#crmContext`, `/api/crm/customer-actions`, CRM chat planner | Live. Chat reads approved memory, open tasks, deals, quotes, recent activity via the caller's JWT (RLS). |
| Long-running jobs | `agent_runs` (lease, cancel, verification) | Live for coding agents only; not reusable for business events without changes. |

## 2. Missing, disconnected, duplicated or simulated

**Identity / records**
- No uniqueness or normalization beyond lower-cased email. 232 duplicate company-name groups exist
  (0 duplicate email groups). No phone normalization, no merge, no merge history, no review queue
  (`identity_review_required` is set on ~62k rows but nothing consumes it).
- No ownership/assignment columns on customers, deals or tasks.
- No consent records; suppression is a single boolean plus Mail's private `contacts.unsubscribed_at`.
- No proposals, payments, onboarding or service engagement tables in production.
  `Veltra-CRM/supabase/007_verified_payments.sql` and `004_service_staff_jobs.sql` exist but were
  **never applied** (tables absent). `IntegrationMilestones` in the UI correctly says Stripe and
  Calendar are "Planned · not connected".

**Timeline**
- `crm_activity` has no source, actor type, status, dedupe key, related records or failure detail.
  It cannot express drafted → approved → queued → provider accepted → delivered → replied/failed.
- Calendar, form, proposal, payment and onboarding activity are not captured anywhere.

**Mail**
- Sync is one-way polling of unhandled inbox mail; outbound messages are not stored as records with
  provider status; "sent" in CRM (`email.replied`, `follow_up.sent`) means "Gmail API returned an
  id", which is provider acceptance, not delivery.
- No shared-inbox ownership, internal comments, reply locks, templates library in CRM, labels in
  CRM, or connection health beyond outbox counts.
- Follow-ups are drafted for unanswered threads but there is no durable schedule that is cancelled
  when the customer replies.

**Automation**
- Three separate loops (Mail poller, CRM outbox drain every 15 s, outreach tick every 30 s) with
  their own retry rules. No shared job table, failure queue, replay, cancellation, loop prevention,
  workspace stop control, send/spend limits or execution history visible in CRM.

**Overview**
- `components/crm/command-dashboard.tsx` computes counts client-side from a snapshot; no reporting
  period, definitions, freshness or unknown-data markers. Preview data is client-side
  (`lib/crm/preview.ts`) and not mixed with production — good — but there is no workspace-level
  demo/test flag.

**Simulated / roadmap-only**: Stripe, Calendar, Onixus Relay, pilot program (UI states this honestly).

## 3. Duplicated sources of truth

| Concept | Copies | Risk |
|---|---|---|
| Customer identity | `crm_customers` (Supabase) **and** Mail "Shadow CRM" `contacts` (Mail Postgres) | Two profiles per person; Mail brief can disagree with CRM. |
| Customer memory | `crm_memories`, `veltra_memories`, `crm_personal_memories`, Mail `contacts` brief, Mail `src/mail/memory.ts` | Five stores, different status models, no provenance/confidence. |
| Suppression | `crm_customers.suppressed`, Mail `contacts.muted/unsubscribed_at` | Unsubscribe in Mail does not stop CRM-initiated outreach unless the bridge call succeeded. |
| CRM UI code | `apps/web/components/crm/*` **and** `Veltra-CRM/components/*` (near-identical copies) | Fixes land in one copy only. |
| Approval queue | Mail `veltra_approvals` (Mail DB) vs CRM `customer-actions` | Chat and Mail show different pending work. |

Decision for Phase 1: **Supabase is the single source of truth** for customer identity, timeline,
memory, consent/suppression, messages and automation. Mail keeps provider credentials and mailbox
operations, and reports to CRM through token-authorized RPCs (the existing pattern). Mail's
contacts become a cache to retire in Phase 2.

## 4. Integration configuration requirements (current)

| Integration | Config (names only) | Status |
|---|---|---|
| Supabase | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (web); Mail uses `CRM_*`/Supabase publishable key | Set in production. Web has **no service-role key** (good; Phase 1 keeps it that way). |
| Onixus Mail | `VELTRA_MAIL_URL` (web) | Set. Gmail OAuth client lives in the Mail service. |
| AI gateway | `AI_GATEWAY_URL`, `NEXT_PUBLIC_VELTRA_API_URL` | Set. |
| Stripe (customer payments) | none | Not configured. Billing service (`STRIPE_RESTRICTED_KEY`) is Onixus's own credit billing, not customer proposals. |
| Calendar | none | Not configured (Google Calendar scope not requested). |

## 5. Security, reliability and migration risks

- **Tenant isolation**: RLS is consistently membership-based — good. `SECURITY DEFINER` RPCs use
  `search_path=''` — good. Risk: definer functions must each re-check membership; Phase 1 adds a
  single helper (`revenue_private.require_role`) and SQL tests for every new RPC.
- **Over-broad activity trigger** writes a row per CRUD change (~64k), drowning real events.
  Phase 1 adds a separate typed timeline instead of rewriting this trigger.
- **Webhook verification**: no payment webhooks exist yet. Phase 1 adds Stripe signature
  verification with timestamp tolerance and an idempotent event ledger.
- **Untrusted content**: Mail already labels email text untrusted. CRM Chat passes activity titles
  (which include email subjects) into prompts without marking them untrusted. Phase 1 wraps all
  customer-originated text and enforces that actions come only from authenticated users or
  explicitly authorized automations.
- **Migration risk**: `crm_customers` (62.8k) and `crm_activity` (64k) are populated. Phase 1 only
  adds nullable columns without defaults (metadata-only in Postgres 11+), new tables, new indexes
  (`create index` — see rollout for `concurrently`), and replaces the `crm_deals` stage CHECK with a
  trigger (0 rows today). No data is rewritten or deleted.
- **Secrets**: Mail seals tokens at rest; web never sees them. Keep it so: the web worker talks to
  Mail through its authenticated API, not raw Gmail tokens.
- **Observability**: failures are mostly `console.error` in Mail; CRM shows only outbox counts.
  Phase 1 makes failures first-class rows (jobs, events with `error`, sync state) with recovery
  actions in the UI.

## 6. Coordination notes

- Open PR #67 (`codex/connection-health-motion`) edits `app/settings/connections/page.tsx`,
  `styles/spatial-workspace.css`, `docs/workspace-build-plan-2026-10-22.md`. Phase 1 avoids those
  files (customer-visible "Veltra Mail" strings remaining in `settings/connections/page.tsx` are left
  for that PR to avoid a conflict).
- Codex is finishing logo assets: no files under `public/brands` were touched.
