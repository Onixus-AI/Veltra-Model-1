# Authenticated age-based Trash commands

A complete direct user instruction such as `Veltra, delete all email older than 1 year` authorizes moving matching messages from the caller's connected mailbox to recoverable Trash. No second permission question or approval-queue step is inserted. An optional explicit mailbox must match the authenticated mailbox. The implementation rejects quoted/hypothetical commands, missing age/date criteria, future/invalid dates, permanent deletion and emptying Trash. Those last two capabilities are not exposed.

Supported date forms: `older than N days/months/years` and `before YYYY-MM-DD`. A request captures one immutable cutoff, with strict `<` comparison. Relative dates use UTC calendar subtraction, clamping leap days/month ends; explicit dates mean midnight UTC. The receipt displays the exact ISO cutoff and mailbox. Gmail uses internalDate and epoch-second search boundaries; Outlook uses receivedDateTime and immutable IDs. It targets Inbox, sent, archive and spam, excluding existing Trash from discovery where the provider supports that filter.

## Execution and retry semantics

- Chat recognizes the latest explicit user message in code and calls Mail's authenticated MCP endpoint. Retrieved email, model text and external context cannot select this command.
- `trash_old_mail` validates the direct instruction again on Mail, resolves the user's existing Chat→Mail link and verifies the actual mailbox address/provider. A stable request key creates or reuses the same durable operation; conflicting reuse is rejected. Replay keeps the original cutoff.
- A Postgres-backed worker enumerates every provider result page before moving any message. There is no 5,000-message or one-page cap. IDs are persisted uniquely and each page/cursor checkpoint is transactional. Scanning and mutation are separate phases so moving mail does not invalidate the discovery page offsets.
- The worker uses leased/fenced operation claims, batches of ten and at most five concurrent provider actions. It survives restarts and rechecks mailbox identity. A connection change blocks the operation.
- Each message is checked against the cutoff again before mutation. Already-trashed, missing and no-longer-matching items are reported separately. Only Gmail's `/trash` and Outlook's move to `deleteditems` are used. No permanent-delete API is called.
- The receipt distinguishes confirmed moves, already in Trash, missing, not matching, failed, uncertain and pending. `matched` is not final until discovery is complete. A provider write with an uncertain result is never counted as a confirmed move.
- `retry_mail_cleanup` is invoked by an explicit retry request or the Mail retry button. It reuses the same operation/cutoff and preserves completed item receipts; provider state is checked before attempting a move again. Existing Trash can therefore reconcile a write whose response was lost without a duplicate move. Provider retention policies can eventually expire Trash; this is not a permanent backup.
- Progress: `show mail cleanup <operation UUID>`. Retry: `retry mail cleanup <operation UUID>`. Mail's Search & follow-ups page also shows the latest 50 operations and refreshes progress every ten seconds.

## Interfaces

Mail: authenticated `POST /api/cleanup`, `GET /api/cleanup`, `GET /api/cleanup/:id`, `POST /api/cleanup/:id/retry`. MCP: `trash_old_mail`, `mail_cleanup_status`, `retry_mail_cleanup`. Neither accepts a caller-supplied account ID. Session writes retain the central CSRF check. Each status/retry read is account scoped. The background worker processes only explicitly created cleanup operations; deploying this feature creates no cleanup operation.

## Validation and limits

Automated fixtures exercise 5,105 messages over complete pagination; exact boundaries and leap/month arithmetic; no mutation before discovery completes; request deduplication; account isolation; mailbox replacement; concurrent worker claims; database checkpoints/RLS; partial and uncertain writes; Gmail epoch/date handling; Outlook immutable IDs and continuation validation; and actual Express/MCP authorization paths. Tests never connect to or mutate a current mailbox. Real OAuth-provider Trash mutations are intentionally not exercised by this implementation request. Outlook needs its provider registration/connection configuration before production use.
