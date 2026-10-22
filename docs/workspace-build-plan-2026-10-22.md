# Workspace build plan — 2026-10-22

## Release ledger

- [x] Workspace permission implementation merged (PR60); production activation remains OFF.
- [x] Task Center and reviewed follow-up workflow merged/deployed (PR61).
- [x] NVIDIA-first gateway routing merged (PR62); actual backend revision and provider responses remain unverified.
- [x] Embedded CRM navigation merged/deployed (PR63).
- [x] Embedded Mail navigation merged (Mail PR33); Railway rollout remains unverified.
- [x] Check public OpenRouter endpoints for all 11 configured primary/fallback IDs. Listings exist; account-key permissions, funding and privacy eligibility have not been proven by inference.
- [x] Build query-aware saved-memory recall and run focused tests.
- [x] Complete full CI and merge/deploy query-aware retrieval (PR64).

## Current retrieval increment

Chat derives up to eight keyword terms from the most recent user message, never from assistant/tool output or image URLs. Search filters the already-authorized, approval/expiry/customer-scoped query in the database before the candidate limit. Up to 100 recent matching candidates are ranked by whole-word/substring coverage; up to 30 records are returned. Existing 18,000-character context cap still applies. Source app, source reference and memory ID are preserved. Blank list requests retain their existing recent-record behavior.

This is lexical search, not embeddings or learned semantic ranking. More than 100 matching records can hide an older, better result. English conversational stop words are removed; synonyms, stemming and multilingual segmentation are not implemented. Source references are supplied provenance, not proof that the source was independently verified. No mailbox/repository ingestion, database migration, permission activation, model switch or background sending is added here.

## Build next, independently of Railway

- [x] Build an inspectable shared-brain view: search, scope, source, approval/expiry, and existing reviewed correction/forget actions.
- [ ] Add ingestion boundaries and source freshness/version tracking before automatic imports.
- [ ] Evaluate embedding/reranking with synthetic data; choose dimensions and reindex strategy before database changes.
- [ ] Add durable task history and safe background job controls.
- [ ] Extend browser actions and verify Super Coder's build/test/deploy loop.

## Resume live verification when infrastructure permits

- [ ] Verify running gateway/Mail revisions, server model overrides, provider-key eligibility and real usage receipts.
- [ ] Require structured-output support for coding provider selection; model listings show some providers omit response_format.
- [ ] Verify designated test-account Chat → CRM → Mail follow-up draft workflow, decline, cancellation and duplicate prevention.
- [ ] Finish task-scoped permission acceptance tests, then explicitly enable the production flag.
- [ ] Compare provider cost per successful task, latency, completion rate and fallbacks; do not assume 50% savings.
- [ ] Roll standalone changes out after workspace acceptance.

## Verification

Focused tests use fixture data plus the real Supabase SDK request serializer, covering query relevance, limits, source retention, expiry/approval/customer isolation and separate PostgREST OR groups. No real customer data or provider inference is used. TypeScript check passes. Full CI receipt belongs in the PR after completion.

## Shared-brain manager — workspace increment

- [x] Add a unique Brain icon and command-menu entry.
- [x] Search saved records in the current personal/business/customer scope; inspect source app/reference, status, expiry and ID.
- [x] Include expired records only on explicit manager request; automatic Chat recall still excludes expired/proposed records.
- [x] Reuse single-use server reviews for add, approve, correct and forget. Corrected records need reapproval.
- [x] Preserve viewer-role and customer/business-wide editing boundaries. No automatic model or provider calls.
- [x] Focused API/domain tests and TypeScript pass locally.
- [ ] Full CI, desktop/mobile visual verification and release review.
- [ ] Signed-in provider/database acceptance remains separate; fixture checks do not prove live account behavior.

The manager is direct account management, not an AI task-access grant. It does not activate the production permission flag, ingest mail/repositories, alter credentials, or change standalone apps.

### Selected Chat memory proposals
- [x] Add Remember to saved Chat text messages; open an editable proposal.
- [x] Verify source ownership, conversation revision, message index and excerpt on the server.
- [x] Check exact text/source duplicates in the selected scope before review. This is a preflight check, not a concurrent uniqueness guarantee.
- [x] Reuse reviewed proposals and separate approval before recall; no model calls or new paid infrastructure.
- [ ] Complete production signed-in acceptance (no active browser session available during implementation).
- [ ] Extend selected-source ingestion to Mail and CRM after backend verification.
