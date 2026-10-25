# Onixus revenue system — phased plan

Journey: prospect → conversation → opportunity → meeting → proposal → payment → onboarding →
service → renewal. One source of truth (Supabase), one authorization model (workspace
membership + RLS + definer RPCs that re-check role), one timeline, one memory, one automation
engine. Onixus CRM, Onixus Mail and Onixus Chat are views and actors over that core.

## Architecture (Phase 1)

```
 Website form ──token──▶ revenue_ingest_form ─┐
 Onixus Mail service ─token─▶ revenue_ingest_mail_event ─┤        ┌──────────────┐
 Calendar (manual / future push) ─▶ revenue_book_meeting ─┤        │ revenue_jobs │◀─ worker (/api/revenue/worker,
 Stripe ─signed webhook─▶ /api/revenue/webhooks/stripe ─▶ revenue_ingest_payment_event ─┤ durable queue│   cron + REVENUE_WORKER_TOKEN)
 CRM / Chat users ─JWT─▶ /api/revenue/* ─▶ revenue_* RPCs ┘        └──────┬───────┘
                                                │                         │ mail.send / mail.follow_up / onboarding.*
                                                ▼                         ▼
          crm_customers ─ crm_deals ─ crm_tasks ─ crm_memories ─ crm_mail_threads (existing, extended)
          revenue_events (typed timeline) ─ revenue_messages (status lifecycle) ─ revenue_suppressions
          revenue_consents ─ revenue_proposals ─ revenue_payments ─ revenue_onboardings ─ revenue_audit_log
```

- Every write goes through a `revenue_*` RPC that checks workspace role server-side; tables are
  read-only to `authenticated` via RLS (no direct client writes to new tables).
- Integrations authenticate with workspace-scoped tokens whose SHA-256 hash is stored
  (`revenue_integrations`, existing `crm_mail_connections`). The web app holds no service-role key.
- Provider adapters sit behind interfaces (`MailProvider`, `PaymentEvents`) so the same journey runs
  against a hermetic harness (fake Gmail, locally signed Stripe events) and against live providers.

## Phase 1 — implemented in this branch

1. Shared customer records: identity normalization, auto-link on exact email, review queue for
   ambiguous matches, reversible merge history, ownership, consent, source attribution, links to
   proposals/payments/onboarding/engagements.
2. Unified timeline (`revenue_events`) with source, actor, occurred/recorded time, related records,
   actual status, dedupe keys, failure detail and recovery action.
3. Onixus Mail pipeline: messages with explicit status lifecycle, approval required unless the
   automation is explicitly authorized, suppression/unsubscribe checks at draft, approval and send,
   reply locks + internal comments, templates, sender identities/signatures/reply-to, labels,
   search, sync state/health, follow-ups cancelled on reply, unanswered-question and promised
   follow-up detection, contextual drafts, untrusted-content handling. Gmail adapter (history API +
   send) behind `MailProvider`; fake provider for the harness.
4. CRM pipeline: configurable stages, kanban + table, customer detail, ownership, tasks /
   commitments / overdue, evidence-based deal health, next-best actions with reasons and links. No
   automatic stage changes from AI inference.
5. Memory with provenance (fact vs inference, source, time, scope, confidence, visibility,
   correction, rejection, expiry, deletion); Chat context through the same RPC and authorization.
6. Payment → onboarding: verified Stripe webhooks, idempotent ledger, out-of-order handling, partial
   payments, refunds, cancellations, onboarding started exactly once.
7. Automation engine: durable jobs with idempotency, retries + exponential backoff, dead-letter
   queue + replay, cancellation, reply-stop, loop prevention (chain depth), permission and consent
   checks, daily send and spend limits, execution history, workspace stop switch. Predefined
   workflows only.
8. Company overview: drillable metrics with period, definitions, freshness and unknowns, daily
   priority list, demo/test workspaces excluded from production metrics.

## Phase 2 — Mail depth and channel consolidation

- Move Mail's "Shadow CRM" (`contacts`) and approvals to read from / write to the shared core;
  retire duplicate memory stores (`veltra_memories`, `crm_personal_memories` become scopes of one
  memory table).
- Gmail push (Pub/Sub `users.watch`) instead of polling; Gmail attachments stored in Supabase
  Storage with workspace-scoped paths and signed URLs.
- Google Calendar two-way sync (booking links, reschedule/cancel ingestion).
- Microsoft 365 (Graph mail + calendar) using the same `MailProvider` interface (an Outlook mailbox
  adapter already exists in Mail).
- Industry campaign templates + sequences on top of the job engine; responsive branded email
  designs with accessible story images (alt text required, dark-mode safe colors, text-first
  fallbacks); A/B testing with reply-based (not open-based) reporting.

## Phase 3 — Voice, SMS and social

- Team calling and inbound call handling (architecture below), SMS/MMS (A2P 10DLC), WhatsApp
  Business Platform, supported social messaging (Instagram/Facebook Messenger via Meta Graph,
  LinkedIn only through approved partner APIs).
- Proposals and e-signatures where incomplete (native proposal pages + Dropbox Sign / DocuSign
  integration evaluated by cost).

## Phase 4 — Intelligence and customization

- Advanced lead routing (round-robin, territory, capacity) and explainable scoring (feature
  contributions shown, no hidden model).
- Visual workflow editor over the proven engine; no-code custom objects; forecasting and
  multi-touch attribution (requires consistent source attribution captured since Phase 1).

## Provider access requirements

| Provider | Access needed | Notes |
|---|---|---|
| Gmail | OAuth client (existing in Mail), scopes `gmail.modify`, `gmail.send`, `gmail.settings.basic` (existing); for push: Pub/Sub topic + `users.watch` | Restricted scopes require Google OAuth verification + annual CASA security assessment for >100 external users. |
| Google Calendar | `calendar.events` scope added to the same OAuth client | Sensitive scope (verification, no CASA). |
| Microsoft 365 | Entra ID app, `Mail.ReadWrite`, `Mail.Send`, `Calendars.ReadWrite`, admin consent per tenant | Publisher verification recommended. |
| Stripe | Restricted key with Checkout Sessions write + read; webhook endpoint secret (`whsec_…`); test mode keys for acceptance | Events used: `checkout.session.completed`, `checkout.session.async_payment_succeeded/failed`, `payment_intent.succeeded/payment_failed/canceled`, `charge.refunded`. |
| Twilio / Telnyx | Account, numbers, A2P 10DLC brand + campaign registration | Do not purchase until approved. |
| Meta WhatsApp | Business Manager verification, WABA, approved message templates | 24-hour customer-service window; templates required outside it. |

## Channel limitations

- Email opens are unreliable (Apple Mail Privacy Protection, image proxies): never evidence of
  engagement. Gmail does not return delivery receipts; "delivered" is only set from an explicit
  provider signal (none for Gmail), so Gmail sends stay at "provider accepted" unless a reply or a
  bounce arrives. Bounces arrive as DSN mail and are parsed as untrusted reports.
- Gmail sending limits: ~2,000/day per Workspace user, ~500/day for consumer Gmail.
- SMS requires A2P 10DLC registration in the US; carriers filter unregistered traffic.
- WhatsApp: business-initiated messages require pre-approved templates.
- LinkedIn has no general messaging API.

## Telephony architecture recommendation (not implemented, nothing purchased)

- Programmable voice via Twilio (or Telnyx for lower per-minute cost) with WebRTC softphone in
  Onixus Workspace; inbound IVR → ring group → voicemail with transcription; calls become
  `revenue_events` (source `phone`) with recording consent per jurisdiction (two-party consent
  states require announcement).
- Media Streams → speech-to-text for summaries after the call (not live auto-actions).
- Identity matching by E.164 phone through the same `revenue_resolve_identity` path.

Indicative list prices to verify before any purchase (USD, US, Oct 2026 knowledge; confirm on the
provider pricing pages):

| Item | Twilio | Telnyx |
|---|---|---|
| Local number | ~$1.15 / month | ~$1.00 / month |
| Inbound voice | ~$0.0085 / min | ~$0.0035 / min |
| Outbound voice | ~$0.014 / min | ~$0.005–0.007 / min |
| SMS segment | ~$0.0079 + carrier fees | ~$0.004 + carrier fees |
| A2P 10DLC | ~$4 brand (one-time) + ~$15 campaign vetting + ~$1.50–10 / month campaign | similar |
| Recording / transcription | ~$0.0025 / min storage-min, transcription ~$0.05 / min | lower |

Example: 5 seats, 2 numbers, 3,000 voice min/month, 2,000 SMS → roughly $60–90/month on Twilio,
$25–45/month on Telnyx, excluding transcription.

## External usage costs introduced by Phase 1

| Service | Cost | Enabled? |
|---|---|---|
| Supabase | Additional tables/rows within current plan; no branches (paid) created | Only after migration is applied. |
| Vercel cron for `/api/revenue/worker` | Included in plan cron limits | Not deployed. |
| Gmail API | Free within quota | Uses existing connection. |
| Stripe | 2.9% + 30¢ per successful US card charge (standard) — paid by the business | Not configured. |
| AI drafting/summaries | Uses existing AI gateway model routing; deterministic fallback when unavailable | Only when a user requests a draft or summary. |
