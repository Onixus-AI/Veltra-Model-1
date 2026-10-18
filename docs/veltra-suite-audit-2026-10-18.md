# Veltra suite audit — 18 October 2026

This report describes the checked source and production configuration. It supersedes older planning documents that described deployments and synchronization as not yet published. No competitive benchmark supports a claim that Veltra is already the best CRM.

## Architecture decision

Separate product databases were not inherently a mistake. The missing contracts and activation were the problem. Keep one canonical customer identity and workspace permission system, with product-specific operational stores.

- Chat and standalone CRM now use the same Supabase project for identities, customers, deals, tasks, reviewed memory and shared activity.
- Mail uses its existing Railway Postgres for mailbox authorization, inbox checkpoints, approvals, encrypted developer connections, CRM outbox and outreach delivery state. Mail is the execution owner; CRM is the customer relationship owner.
- The old standalone CRM project is preserved. Its earlier audit found zero Auth users and four legacy customer rows; no deletion or cross-account merge was performed.
- Standalone Mail remains independent. CRM + Mail outreach should work without buying Chat, using the same Veltra identity and a linked Mail account. The existing account-link flow still lives in the Chat Connections screen; a CRM-native Mail login/link flow is a remaining product gap.

## Verified audit findings before this release

| Area | Evidence | Implication |
| --- | --- | --- |
| Customer data | 662 records, all with email, zero duplicate workspace/email groups, zero identity flags, zero suppression flags | Counts do not prove addresses are verified or outreach consent/relevance |
| CRM permissions | All 15 CRM public tables have row-level security; tenant and viewer tests pass | Preserve explicit workspace authorization on every new action |
| Mail ↔ CRM | Zero active CRM Mail connections | Shared context and CRM event sync require owner activation |
| Business pricing | 14 industry categories and industry intake defaults; prices mostly free text; only warehouse had a service picker | Industry labels alone did not make pricing reliable |
| Onixus setup | Warehousing profile, warehouse rates, saved trucking-style intake; pallet storage described per container | Replace stale intake after review; never infer or silently change billing units |
| Vercel | Chat/CRM projects hosted; in-product connector reports Setup needed | Hosting access is separate from client OAuth authorization |
| Vercel connector configuration | WORKSPACE_VERCEL_CLIENT_ID, WORKSPACE_VERCEL_CLIENT_SECRET, WORKSPACE_VERCEL_INTEGRATION_SLUG absent from Mail service | Existing Veltra Workspace integration was found with the correct callback and read-only Projects/Deployments scopes. Public slug configured; client ID/secret still need private entry. No secret was read or invented |
| Automation | Existing inbound email approvals/followups and CRM tasks; no campaign/sequence execution engine | Outreach required durable state, review, limits and stop rules |
| Ordinary Chat | Text generation endpoint had no execution tools yet called itself an automation platform | Strengthen honest-action instructions; Super Coder and tools must supply real receipts |
| Industry operations | Staff/jobs/payment SQL exists in source but related tables are absent in canonical production schema | Do not present scheduling/payments as live capabilities |

## Changes in this release

### Industry pricing sheet

Businesses can select multiple service areas with checkboxes, including trucking and warehousing together. Each selected area has its own service pricing sheet, suggestions, billing-unit guidance and scoped intake questions. Existing single-industry accounts remain compatible. Suggestions contain no made-up rates. Owners can add missing industry services without replacing their saved prices. Structured USD amount/unit fields support pallet, container, item, square foot and guest, alongside existing units. Structured rates take precedence consistently in code and model facts; legacy descriptions remain stored.

Pricing health flags missing rates, free-text ambiguity, conditional scope, and saved trucking intake on a warehouse business. Live Onixus setup was saved with warehouse intake and the explicitly configured $12/pallet rate structured; legacy prices were preserved. Health items fell from 12 to 10. Remaining units and missing prices require owner input. Storage duration is requested only for storage work; industry suggestions avoid duplicate explanatory service names. Explicit scope notes force quote review. Fixed service quotes remain quotation-only, with the supported rate before scheduling. Combined quotes calculate structured service rates × explicit quantities × configured days/months, and add authoritative transport tariff or mileage totals once. Every requested component must be priced; missing transport/quantity/duration and duplicate freight charges block a final total. Legacy text rates need structured confirmation before combining. Combined calculations require owner review. Percentage commissions, taxes, storage tiers, freight accessorial ambiguity and full contract estimates still need richer calculation or authoritative industry APIs. A unit quote is not a calculated job total.

### Reviewed outreach engine

CRM and embedded Chat CRM gain an Automation view. Owner-selected recipients (up to 50/campaign), plain-text personalization, postal address, explicit message preview/approval, paused campaigns, two-step UI sequences (API up to three), configured delays, weekday 9–17 sending hours, 1–50 daily account cap (default 10, UTC day), and two-minute account pacing.

Mail owns a durable campaign/message store and provider receipt. CRM remains authoritative for identity, owner permission and suppression. Ambiguous, changed, suppressed, missing or unreviewed identities fail closed. Mail must be linked to the same workspace. Muted/unsubscribed contacts are blocked. Any observed inbound response stops further outreach for that address before folder routing or model calls; explicit STOP/unsubscribe requests also suppress the shared CRM contact. Reply stops depend on inbox processing, not instant provider webhooks. Sending requires a recent completed inbox pass without errors/backlog, no current inbox pass, and an unpaused Mail account.

Each follow-up is created as a new draft requiring separate approval. The legacy followup generator and its send path defer campaign recipients to Outreach. Operation IDs prevent duplicate campaign creation after network retries. Duplicate unfinished audience enrollment is rejected. Account dispatch locks serialize provider calls across replicas. Unknown or interrupted sends become uncertain and never auto-retry. A provider acceptance receipt does not prove inbox delivery. No production campaign was created or activated during testing, and no customer email was sent by these tests.

### Model route health

Live Mail startup checks passed sorting, replies and quotes but initially failed the follow-up and backup defaults under the existing provider guardrails. Their defaults were changed to the already working reply/quote route. Privacy settings and provider guardrails were preserved. Remaining fallback endpoints are not all independently verified.

### Connection and security fixes

Vercel setup cards expose missing variable names and the registered callback, never secrets. The existing OAuth integration remains blocked until registration/consent is complete.

CRM's token-authenticated Mail policy now returns explicit customer identity and review status; an account-bound opt-out RPC updates only the linked workspace. Token mismatch tests and live rolled-back checks cover identity and suppression. Two existing credit functions now have fixed search paths, and direct browser execution of two trigger-only provisioning functions was revoked without changing trigger behavior or balances.

Security advisor's remaining public SECURITY DEFINER warnings are the intentional token-authenticated CRM Mail endpoints, not open unauthenticated customer access. Server-only tables with RLS/no policies are deny-by-default. Leaked password protection remains disabled and needs a separate Auth configuration check.

## Highest-value remaining gaps

| Priority | Gap | Concrete completion criterion |
| --- | --- | --- |
| P0 | Activate Mail ↔ CRM | Owner consent; correct workspace; test event visible once; suppression blocks send before provider |
| P0 | Finish Vercel OAuth app | Existing registered integration verified; finish private credential entry, real consent, selected project deployments displayed |
| P0 | Confirm Onixus pricing meaning | Resolve pallet/container ambiguity; fill supported rates; replace stale intake; test representative quotes without sending |
| P1 | Deliverability and abuse feedback | Verified SPF/DKIM/DMARC, mailbox/provider limits, hard-bounce/complaint events, automatic global suppression, tested unsubscribe coverage |
| P1 | Real outreach outcomes | Link reply → qualified opportunity → meeting → accepted quote → verified payment; report actual conversion and cost per outcome |
| P1 | Lead discovery execution | CRM Sources UI currently records requests; connect approved research worker/provider, retain source and freshness, review imported identities |
| P1 | Structured quote calculations | Versioned catalog, dimensional/tier pricing, tax/discount order, quote expiry, acceptance and signed quote records; basic quantity × duration bundles now implemented |
| P1 | Booking + payment + fulfillment | Atomic availability/booking, reschedule/cancel, signed provider payments/refunds, service entitlement and onboarding; source SQL alone does not complete integrations |
| P1 | Reliability and recovery | Outbox/dead-letter view, alerting, sent-mail reconciliation for uncertain deliveries, backup restore drill, live multi-replica contention tests |
| P1 | CRM-native standalone onboarding | Link Mail and configure automation directly from CRM without visiting Chat UI |
| P2 | Chat-native business tools | Typed propose/approve/execute actions with receipts; ordinary conversation cannot execute tasks; add controlled campaign editing after real tool wiring |
| P2 | Team operations | Invites/roles UI, assignment, collision prevention, shared mailbox and owner delegation |
| P2 | Product customization | Workspace templates, custom fields/views and brand presets beyond current local accent/density controls |

## Validation and limits

Mail automated tests include the real SQL engine for durable workflow state with fake mail providers; PGlite lock functions are stubs, so distributed lock contention is not proven by those tests. API tests cover authenticated account/workspace binding. Mail backend typecheck, web build and clean dependency install are required. CRM unit/database tests and both Next production builds are required. Live RPC checks run within rolled-back transactions. Recheck terminal deployment status after publishing.

No live campaign send, provider deliverability test, booking, payment, real microphone transcription or historic email backfill was performed. Mail-CRM owner approval and Vercel credential entry/consent remain external activation gates. Current UI/API caps and review controls intentionally bound this first rollout; this is an automation foundation rather than unrestricted autonomous selling.

## Success measures

Measure customer outcomes: time to accurate quote; quote acceptance; positive replies per delivered outreach; meetings held; verified paid conversions; overdue followups; suppressed/bounced contact attempts (target zero); duplicate sends (target zero); action failure/recovery time; cost per qualified meeting and paid customer. Prefer those to number of agents, messages generated or an unsupported completion percentage.
