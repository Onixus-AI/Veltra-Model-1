# CRM control from Veltra Chat, standalone CRM and standalone Mail

## Behavior implemented

- Standalone CRM has a signed-in, workspace-scoped assistant.
- CRM embedded inside Veltra workspace hides its assistant. Only the main workspace conversation controls CRM.
- Customer selection is passed from the CRM frame to the host. The host checks both origin and the exact frame window; no tokens or customer content cross window messages. Chat context follows the selected workspace/customer, and sends wait for the matching conversation to load.
- A standalone full-window CRM link does not retain the embedded flag. A top-level URL with a stale embedded parameter still shows standalone chat.
- Standalone Mail keeps its existing assistant. A Mail/CRM selector in that same assistant connects to CRM, selects a workspace/customer, and calls the shared CRM action endpoint. It does not create a second conversation UI.
- Mail embedded through the existing workspace proxy hides its own assistant navigation and never mounts the assistant, including a saved #assistant URL.

## CRM actions

Read customers, search company names, show open/overdue tasks, pipeline, customer activity, approved/unexpired memory and campaign status. Create customers, tasks and opportunities; propose memory; complete tasks; change deal stages; suppress outreach; pause/activate existing campaigns. Exact unique task/deal titles and campaign names can be used instead of copying record IDs.

Changes produce a readable preview first. Confirmation records live in the existing CRM conversations table and are bound to the authenticated user, workspace and selected customer. A ten-minute expiry and atomic revision claim prevent expired or duplicate execution across processes/restarts. Changed task/deal/suppression state requires a new review. Supabase membership and row policies still authorize every operation. New records generate the existing database activity entries. An uncertain write is not automatically retried.

Campaign activation is owner-only. It uses the existing Mail outreach engine and allows only its previously approved messages to run. Chat does not silently approve drafts, create unreviewed recipients, permanently delete CRM records or send mail itself. Pipeline stage changes do not establish payment receipt.

## Configuration and sign-in

Main Chat, standalone CRM and Mail's configured Chat identity must refer to the intended shared Supabase identity and CRM tables. No service-role credential is exposed or substituted for the user's authorization. Existing CRM schema/suite tables and membership policies are required; this change adds no database migration.

Mail's standalone assistant explicitly signs into the CRM identity. Its access/refresh credentials are sealed in an account-bound HttpOnly, SameSite=Strict cookie scoped to /api/crm-chat; the password is not retained. The configured canonical Chat origin supplies the CRM API. Browser input cannot choose a destination server. Mail's existing origin checks protect cookie-authenticated writes. Disconnecting removes the local CRM-chat session cookie.

Common commands run without a model. Optional AI_GATEWAY_URL and CRM_CHAT_MODEL enable flexible phrasing through the existing authenticated gateway. Main Chat can pass its selected model when CRM_CHAT_MODEL is unset. The planner returns only an allowlisted action proposal; workspace selection and execution authorization remain server-controlled. Missing details and ambiguous names require clarification.

Examples:
- Show customers
- Find customer Acme
- Show overdue tasks
- Show pipeline
- Add customer Harbor email hello@harbor.test
- Add task Send proposal due 2026-11-01T14:00:00Z
- Create opportunity Website renewal worth 500 USD
- Remember customer prefers mornings
- Complete task Send proposal
- Move deal Website renewal to proposal
- Show campaigns
- Pause campaign Autumn follow-ups

## Validation and rollout status

Mail's 97-test suite passed, including the new account-bound CRM sign-in/proxy test. Chat's full 16-test suite passed before the additional exact-name resolution test; the final action/API tests are rerun after that change. CRM's final 14-test suite and the additional exact-name/amount parser checks passed. Forty-one database assertions passed for tenant isolation, roles, constraints, audit and research permissions. Type checks passed in all three source trees, and Mail UI production build passed.

Actual React components were mounted in an isolated DOM test with fictional authentication/data responses. It checked standalone chat, preview/confirmation, embedded suppression, top-level restoration, trusted frame context, Mail-to-CRM sign-in and review/confirmation. These tests are not a live browser acceptance check. Chrome launch was blocked by this execution environment. No live user records, campaigns, mailbox messages or model calls were used.

No production deployment occurred. Main Chat's production build and standalone CRM's exact pinned Next.js 16 dependency build have not been run for this increment because the machine is nearly full. Standalone CRM type checks reused the available compatible Supabase/React/TypeScript packages; production must install its own lockfile. Temporary dependency links used during checks are removed afterward. A real signed-in browser acceptance check on a designated test workspace is still required before rollout.

Deploy the shared CRM assistant endpoint on the canonical Chat host before rolling out the Mail proxy/UI, and deploy the matching standalone CRM UI/API. Verify the existing suite schema, identity project, cookie behavior over HTTPS, optional gateway configuration, selected-customer context, review/replay behavior and campaign-owner access. Use a designated test workspace; outreach remains governed by its existing approvals and sending limits.
