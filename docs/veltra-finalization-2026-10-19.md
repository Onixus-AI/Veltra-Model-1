# Veltra completion and dependency report — 19 October 2026

## Completed implementation

- Preserved the current shared-theme, dedicated Mail/CRM logos, Bee connection, Design workspace, coding queue and connected developer tools from the other workstreams. No logo or Design changes were overwritten.
- Connected explicit Mail commands in the main Chat endpoint to the authenticated Mail MCP backend: mailbox search, unanswered quote candidates, follow-up drafts, folders and reviewed customer-loss feedback. Responses use actual tool receipts. These direct commands do not need a language-model response or additional Chat generation credit.
- Added recoverable Trash commands, durable paginated discovery and batching, an exact frozen UTC cutoff, ownership checks, idempotent operation receipts, transparent partial-failure counts and scoped retries. A direct request authorizes the operation without another permission question. Permanent deletion and emptying Trash are not exposed. Deploying or testing this capability does not delete any current email.
- Finished reviewed quote-outcome delivery through Mail's durable CRM outbox. Confirmed the structured quote-outcome RPC/column on canonical Chat/CRM Supabase and corrected the existing CRM email-validation pattern that rejected normal addresses. Added an authorized CRM quote-outcome view and quote context in customer conversations. No ambiguous CRM deal is automatically changed.
- Added progress/retry visibility in Mail's Search & follow-ups page.

## Validation

Mail backend typecheck, 99 automated tests and web production build; Chat typecheck, ten web command/connection tests and production build. A temporary, rolled-back canonical-database fixture verified quote outcome persistence, wrong-token rejection, workspace binding, duplicate event handling and invalid loss classification. No fixture remained in CRM. Mail deletion tests use local mailboxes/provider stand-ins, including 5,105 messages; no real mailbox message was moved. Production release status and live read-only smoke checks are reported separately with the deployment commit.

## Dependencies and remaining work

| Area | Current boundary | Needed next |
| --- | --- | --- |
| Mail ↔ CRM live synchronization | Canonical CRM currently has zero linked Mail workspaces; code/database contract is ready | Workspace owner chooses the intended business and clicks Connect Mail in CRM → Integrations. Do not link a client's mailbox to Onixus by inference. |
| True provider Trash acceptance | Connected capability and fixture coverage; no current-message deletion authorized for this test | A future direct age/date request or a designated test-mailbox acceptance run. Outlook additionally needs its provider app/connection setup. |
| Follow-up drafting | Automatic discovery and reviewed sends; model drafting still uses the configured provider | Working provider allowance/credentials. App credits are not the same as provider funding. |
| Shopify for unrelated customer stores | User-scoped install/catalog/reviewed title-edit foundation | Registered public Shopify app, distribution approval, merchant OAuth and webhook/privacy lifecycle validation. Orders, refunds, inventory writes and multi-store/team delegation still need engineering. |
| Stripe and Google Calendar | Provider integration is not fully activated for the Onixus pilot | The intended business authorizes its Stripe account and Google Calendar, followed by test-mode payment/booking acceptance. |
| Onixus TMS / Drayage | Existing transport foundation and multi-service setup retained | Owner-reviewed lane/storage rates, company-specific Mail/CRM/TMS authorization and a supervised operational pilot. |
| Mortuary onboarding | Operational readiness gates and custody references exist | Client owner account/company, approved dispatch/coverage/rates/SOPs, qualified jurisdiction/partner review, and supervised custody rehearsal. This is not nationwide regulatory certification. |
| Veltra Gather | Read-only Zee-compatible adapter is prepared and disabled by default | Approved isolated event backend, customer authorization bridge, role model and workspace UI/write-tool engineering. Zee client production data is not repurposed automatically. |
| Public launch security | Existing account isolation, RLS and authenticated tools retained | Leaked-password protection, callable privileged-function review, backup/restore drill, edge abuse controls, alerting and independent cross-tenant security testing remain launch gates. No foolproof-security claim is made. |
| Duplicate legacy Mail service | Earlier containment kept polling disabled and sleep enabled | Dependency/data inventory and backup before permanent retirement. No service/database was deleted in this release. |

The separate Chat/CRM, Mail and TMS databases remain intentional ownership boundaries. Explicit authorization and idempotent integration events provide synchronization; merging databases is not required.
