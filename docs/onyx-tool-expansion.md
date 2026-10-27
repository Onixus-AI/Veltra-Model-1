# Onyx operator tools — non-Signal expansion

The Google file editor and Calendar already existed. This change connects their existing user-owned backend grants to Chat's model tool loop without adding OAuth scopes.

## Implemented

- Drive account status, filename search/pagination and supported previews.
- App-authorized Docs/Sheets reads, reviewed creation and edits. Docs use full text replacement; complex Docs stay in Google. Sheets edit only specified cells within existing 100-row/20-column bounds and preserve formulas.
- Calendar account/health, calendars, event windows and reviewed create/update/cancel. Selected CRM Workspace must match the connected Calendar. Existing backend enforces organizer, etag, notification and CRM-ingestion rules.
- Private brand file metadata and bounded text/CSV/JSON reads. These are signed-in owner files, not a shared client brand library.
- Linked Mail pause/processing health. This is visibility, not historical-message recovery.

Google write reviews bind owner, Workspace/customer context, account email and ten-minute expiry. Confirmation claims the review before forwarding an existing one-use provider ticket/snapshot. Backend connection-version and freshness checks remain authoritative. Provider receipts are saved; uncertain results stay consumed to prevent automatic duplicate writes.

Google, Calendar and brand files have separate task permissions. Existing permissions do not grant new app access. Direct panel routes keep rejecting generic task headers; model actions use the allowlisted agent endpoint. The advertised catalog stays within the deployed gateway's 32-tool limit.

## Activation

Apply `20261027200448_onyx_google_tool_access.sql` to Workspace, then deploy the web app. Existing Google backend/credentials are reused. Pending migration causes new task permission decisions to fail closed. Verify account status, file read, reviewed creation/edit, Calendar notification review and provider receipts in production. Do not use client accounts as tests.

## Remaining autonomy work

- Persistent business goals, scheduler, retries, budgets and pause/resume. Existing coding-team runs are not this system.
- Arbitrary Mail drafting/sending and outcome reconciliation. Current follow-up action prepares drafts for Mail approval.
- Shared company brand ownership and scoped agency delegation.
- Unified approvals/history and lead-to-revenue measurement.
- Tenant-specific Slack connection and tools.
- Signal campaign tools last, per user direction.

No unattended production deployment, silent client-account switching or continuous underlying model training is enabled.
