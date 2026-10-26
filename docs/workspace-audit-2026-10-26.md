# Onixus Workspace audit — 26 October 2026

Scope: Workspace, Mail, CRM, Google files and the shared agent. Signal is being handled separately by Claude. Findings distinguish live observations from source capabilities; a connector or source implementation is not proof of a completed production workflow.

## Urgent: info@onixus.xyz

The deployed classifier fixes (Mail main 31748b6) increased structured-output capacity and added fallback/error reporting. Live runtime showed successful classifications, replies and healthy CRM relay ingestion after earlier OUTPUT_PARSING_FAILURE alerts. Successful classification logs did not identify the served model, so Nemotron specifically could not be verified from that evidence.

Mail PR53 adds actual served-model metadata to successful classification activity and scan health. It also reports active scan progress, counts failed messages honestly, and provides Gmail inbox pagination beyond the first 30 messages. Backend tests (154) and the Mail production web build passed. These are reliability and visibility improvements, not proof that every historical message has been recovered.

### Remaining critical recovery gap

The graph marks a message processed after classification, before drafting/sending completes. A later model failure can therefore leave a handled message without a completed draft/reply, excluded from the next unprocessed query. Fix with durable per-message checkpoints and recovery states; never blindly replay a possibly completed send, booking or other external write. Reconcile uncertain sends with provider evidence and put unresolved cases into review.

The automatic intake query is `in:inbox -label:Veltra-Handled newer_than:7d`. Archived mail and older mail are outside it. Whole-mailbox search exists, but historical discovery is not equivalent to historical processing. Do not remove this limit and auto-send historical replies. Build a review-only reconciliation showing provider message ID, received date, classification, draft/review/reply outcome and failure reason.

Long fallback chains and sequential account processing can stall a batch. Add bounded provider timeouts, durable retries, account fairness and alerts for stalled workers, exhausted model routes and reconnect requirements. A linked mailbox alone must not show healthy processing.

## Capability assessment

| Area | Evidence and current limit | Required next step |
| --- | --- | --- |
| Mail | Live inbox, activity, approvals, classifications/replies and CRM ingestion observed. Old UI showed a previous scan error while another scan was active. | Deploy scan progress/model telemetry; close durable recovery gap; reconcile inbox/archive/history. |
| Workspace home | Connection status previously measured account linkage. Generic product icons and a stale VELTRA CHAT label remained. | Use processing-aware Mail health and approved product icons (included in this change). |
| CRM | Contacts, companies, deals, tasks, source research/outreach and activity components exist. | Verify lead capture → identity resolution → timeline → assignment → outcome end to end with durable receipts. |
| Forecasting | Weighted pipeline uses explicit stage assumptions. | Label assumptions; validate forecasts against actual outcomes. It is not a demonstrated predictive model. |
| Google files | Document text editing and basic spreadsheet editing/formula persistence were verified; Drive access is connected. | Expand document fidelity, spreadsheet ranges/formulas and reviewed Chat actions. This is not complete Google Docs/Sheets feature parity. |
| Calendar | Connector implementation exists. | Verify the intended user's connection and create/update/cancel plus CRM logging end to end. Admin calendar connectivity does not prove Workspace calendar connectivity. |
| Communication | Email is the strongest channel. Alert adapters include Slack/Telegram/Twilio. | Two-way calling/SMS/WhatsApp/social inbox, recordings/transcripts and consent controls require separate end-to-end implementation and provider approval. Alert delivery is not a native contact center. |
| Automations | Research/outreach workers and bounded actions exist. | A complete visual branching/waiting workflow builder with durable execution history/replay is not verified. |
| Chat tools | Scoped CRM/Mail reads and reviewed actions, shared-brain recall and selected developer actions exist. | Add reviewed Google document/sheet/calendar actions and a source-backed cross-app work queue. Public browser inspection is not logged-in browser automation. |
| Learning | Explicit scoped facts/preferences/procedures can be stored and recalled. | Add reviewed learning from corrections, retrieval evaluation and feedback outcomes. This is not continuous model training/fine-tuning. |
| Brand files | Customers have private upload/download/Trash/restore; Onixus marketing files were removed from customer folders. | Team/company shared brand libraries and quota reclamation still need product work. Current limits include 3 MB/file, 50 MB and 200 files including Trash. |
| Team/security | Role and membership code exists. | Validate invitations, shared mailbox delegation, collision prevention, enterprise SSO/2FA enforcement, audit retention and restore drills. Do not infer readiness from schema alone. |
| Performance/reporting | Bounded activity and operations views exist. | Benchmark 100k contacts/search latency and define freshness, completeness and recovery SLOs. Full attribution needs validated source-to-revenue events. |
| Daily execution | “Plan my day” starts a Chat prompt. | A scheduled personalized morning brief and closed-loop next-action queue are not yet verified. |
| Proposals/payments | Quote and payment-related code exists. | Validate quote → signature → payment → deal/timeline outcome; a webhook is not evidence of the whole flow. |

## Is Onixus building itself?

Not as an unattended production loop. Reviewed repository changes/draft PRs and bounded verification exist, but repository publishing is disabled by default unless explicitly enabled. Selected infrastructure tools are scoped reads. There is no verified observe → diagnose → patch → regression test → preview → merge → deploy → monitor → rollback loop.

Build this incrementally: collect failures with tenant-safe evidence; prepare isolated changes and meaningful regression tests; produce exact-commit CI and preview receipts; require promotion policy; monitor deployment outcomes and support rollback. Do not enable blind production merging or claim access to logs/tools the agent does not have.

## Work order and acceptance criteria

1. **P0 Mail visibility:** actual served model, live progress, truthful failed counts, older inbox pages and health-aware homepage. Tests and production verification required.
2. **P0 Mail recovery:** every eligible message has a durable outcome; model failures remain retryable; uncertain sends are reconciled, never duplicated. Historical backfill is review-only.
3. **P1 Unified work queue:** priorities cite source messages/deals, proposed action, owner and outcome; scheduled briefs use verified data.
4. **P1 Cross-app execution:** reviewed Google file/calendar actions persist and return provider receipts; scopes and account identity stay explicit.
5. **P1 Team and self-build:** shared business access and brand ownership; isolated repair PRs with exact-commit tests/previews and deployment monitoring.
6. **P2 Platform completeness:** custom object UI, durable visual automation, full approved communication channels, validated attribution/forecasting and performance/recovery benchmarks.

No claim of “fully autonomous” or “zero manual entry” is justified until capture completeness, recovery and action outcomes are measured across connected accounts.
