# Chat-driven Mail cleanup — first implementation

## Scope

Chat now routes explicit cleanup requests to the linked Mail service rather than asking the model to simulate an action. Example: `Delete all emails not in a folder that are over 100 days old`. The first request only prepares a preview. The user confirms with `Confirm cleanup <ticket>` from that preview.

The authenticated POST `/chat/mail-cleanup` accepts `preview_cleanup` (days and optional exclude_starred) and `confirm_cleanup` (ticket). The account is resolved from the verified Chat identity and existing Mail link, never a caller-supplied account ID. Existing Gmail modify authorization is used.

Gmail is supported initially. “Not in a folder” means no custom Gmail labels, including Veltra-created labels. Inbox and archived messages may match. Sent, Drafts, Spam and Trash are excluded. Age uses Gmail's received/internal date and a fixed UTC cutoff captured at preview time. Optional starred exclusion is explicit.

Previews contain up to 100 messages and disclose when more matches exist. Confirmation attempts only the reviewed message IDs. Each message is fetched again and its current date and labels checked before moving it to Trash. Filed or otherwise ineligible messages are skipped. Gmail does not offer an atomic conditional trash operation; a concurrent label edit between the final check and move remains possible.

Review tickets expire after ten minutes and are bound to Chat user, Mail account and mailbox address. Tickets are consumed before provider calls, so a replay or concurrent confirmation cannot execute twice. A replaced mailbox requires a fresh preview. Provider failures are reported as uncertain and never retried automatically. Execution stops starting new message operations after its time budget; untouched IDs are reported separately.

## Operational limits

This is a local implementation, not a deployed production feature. Preview tickets are process-local: restarts invalidate them and multiple replicas require a shared atomic ticket store or sticky routing before rollout. Cleanup emits account-scoped preview/completion events through the existing event channel; this is not a new durable per-message audit database. Restore is through Gmail Trash while retained; there is no in-chat undo or permanent deletion. The interface uses the existing Chat response renderer and a typed confirmation command rather than new action cards.

No live mailbox cleanup or outreach was performed during development. Gmail calls in tests are mocked. A designated test mailbox acceptance check and shared-store implementation remain before production activation.

## Next increments

1. Persist review tickets and per-message results with atomic claims and durable action history.
2. Add selectable review cards and a Trash recovery action.
3. Connect Chat to existing CRM campaign previews and controls. Existing Mail outreach already has durable enrollment, sending windows, daily limits and suppression; inspect and extend that implementation rather than introducing a second scheduler.
4. Add CRM record actions and linked follow-up tasks, then shared inbox coordination and provider-specific Outlook cleanup.
