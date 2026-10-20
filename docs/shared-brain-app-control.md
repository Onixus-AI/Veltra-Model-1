# Shared second brain and connected app actions — first increment

This increment extends the established tool-calling runtime. It adds eight model tools: capability discovery; CRM reads and reviewed changes; memory search and reviewed changes; Mail search, thread reading and reviewed follow-up draft preparation. Existing GitHub file reads and reviewed existing-file draft PRs remain available. Vercel, Railway, Supabase management and n8n connections remain read-only in this increment. A connection does not imply write permissions.

## Shared knowledge

Apply `supabase/shared-brain.sql` once to the **existing shared Chat/CRM Supabase identity project**, after CRM schema.sql and suite.sql. The canonical copy also ships in Veltra-CRM. It is a setup script consistent with the repositories' existing suite SQL distribution, not an automatically applied migration. Do not run both copies. This release does not apply production SQL.

The new `veltra_memories` table supports personal, business-wide and customer-specific facts, preferences, procedures and project notes. Personal facts are private to their author. Business facts require membership; viewers can read but cannot change them. A customer belongs to its business through a composite foreign key. Scope and author are immutable, updates advance a revision, and RLS protects direct Data API access as well as application requests. No service-role key is used for knowledge access.

Proposals require confirmation to save, then approval before automatic recall. Corrections return to proposed status. Approved and unexpired business-wide knowledge accompanies selected-customer knowledge, without importing another customer's facts or personal memories. Main Chat receives bounded approved recall automatically. CRM summary results include approved shared knowledge. Standalone Mail uses the same canonical service through its existing CRM sign-in and **CRM + shared brain** selector; Mail credentials alone never grant CRM access. Existing customer memory and project document stores remain intact and are not automatically reclassified or imported.

Sources retain their app and reference, with expiry and revision. Saved procedures are reference material, never permission to execute. Knowledge is deliberately selected by scope and bounded text matching in this increment; semantic/vector retrieval, automatic extraction, outcome learning and attachment ingestion are later work. No model is being retrained.

Commands available in Chat and standalone CRM/Mail CRM mode:

- `Show brain`
- `Search brain for support hours`
- `Remember for business: our support hours are 9–5 Eastern` (business conversation, All customers)
- `Brain remember: customer prefers email` (selected customer)
- `Remember procedure: verify invoice details before preparing a payment` (selected scope)
- `Approve memory <memory ID>`
- `Correct memory <memory ID>: updated fact`
- `Forget memory <memory ID>`

Main Chat shows tool review controls. Direct commands return a typed confirmation token; standalone CRM and Mail reuse their existing review button. Memory IDs are included in search results. Forgetting deletes the saved knowledge record from future recall, not existing conversation history or past review transcripts. Completed memory reviews retain an action receipt without copying the reviewed memory content.

## Actions and review

All model actions go through an authenticated server endpoint. Identity and selected scope come from the verified user and conversation, not model arguments. CRM actions preserve membership, viewer restrictions, selected-customer validation, durable single-use reviews and current-record checks. The client waits for review before calling confirmation and sends the real result back to the model. Declined actions produce no mutation.

Mail preparation binds its review to the linked account, link version and mailbox address/provider. Reconnecting or replacing a mailbox invalidates the review. Preparation only creates follow-up drafts for the existing Mail approval queue. It never sends messages. Existing explicit recoverable-trash commands retain their existing behavior.

Deploy Mail's updated MCP tools before enabling the new Chat Mail tool. Deploy Chat and standalone CRM against the same identity/schema. Roll out the shared schema before trying memory commands; otherwise the brain reports unavailable and ordinary Chat continues without invented memories. Test on a designated test workspace and mailbox before production acceptance.

## Browser skill

Browser automation is **not implemented or advertised as available** by this increment. Capability discovery reports it unavailable. The next implementation should use an isolated per-user browser session, with no shared cookies, bounded public-network egress and a separate action broker. It should inspect pages and screenshots, navigate, click and fill forms, and verify the resulting page state. Login handoff must keep secrets out of model context. Submission that sends, purchases, publishes, deletes or changes permissions needs the same scoped, expiring review and a real result receipt. Site content is untrusted evidence and cannot authorize actions or promote a procedure into approved memory. Prefer the connected API when it supports the requested operation.

## Verification

Unit and API tests exercise approve-before-recall, cross-app provenance, personal/business/customer isolation, expiry, single-use review, concurrent confirmation, stale corrections, forgetting, CRM tool classification and conversation/context mismatch. Real PostgreSQL-compatible database checks cover RLS, foreign keys, viewer restrictions and immutable scope/revision enforcement. Mail MCP tests cover reconnection and mailbox replacement. The model-loop test checks both confirmed and declined actions. No real messages or customer records are changed by these tests.
