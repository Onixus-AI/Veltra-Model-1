# Veltra experience acceptance checklist

Design direction confirmed October 21, 2026: use Apple-level clarity, hierarchy, consistency and interaction quality with Veltra identity. This is a review of complete experiences, not a visual reskin. Solid black canvas and solid surfaces; cyan primary icons/actions; hot neon magenta, lime, lemon, purple, orange and red provide purposeful accents. Black and cyan remain the identity. External products use their genuine brand marks and original colors; Veltra navigation uses distinct line icons. No glass, gradients or blurred chrome. Keep existing functionality.

## Review rule

For every section inspect the entry point, primary task, hierarchy, controls, feedback, errors, empty/loading states, keyboard access, compact/mobile layout and return path. Record a concrete issue before changing code. Mark complete only after visual and interaction verification, not merely after changing styles. Preserve labels/tooltips for icon-only navigation. Desktop density must not make touch controls unusable.

## First correction released

- [x] Replace Mail and CRM product logos in the workspace rail with cyan line icons.
- [x] Give different workspace destinations distinct icons, preserving their functions.
- [x] Keep the CRM header structure stable on every tab, including customer records.
- [x] Keep workspace header solid black and remove command-overlay blur.
- [x] Verify initial correction with type/build and desktop/mobile browser CI. Workspace PR55, CRM PR14 merged. Production confirmation is separate.

## Section-by-section review queue

- [ ] Workspace shell: mode switching, full-area app selection, split view, collapse, clean empty workspace and restoration.
- [ ] Chat: transcript hierarchy, composer, attachments, tool progress, failure/retry, context and a single active conversation.
- [ ] CRM overview: scan order, real KPI freshness, charts, drill-downs and clear next action.
- [ ] CRM customers and records: list/detail navigation, search, forms, research and memory provenance.
- [ ] CRM pipeline: stage movement, selected deal details, empty stages and narrow layouts.
- [ ] CRM automation: audience selection, exact message review, approval versus activation, receipts and failures.
- [ ] CRM memory, sources and industries: review states, navigation consistency and source visibility.
- [ ] CRM connections: connection health, setup/reconnect, owner/workspace scope and useful errors.
- [ ] Standalone Mail: three-pane layout, inbox/search, reader, compose, approval and activity states. Deployment currently delayed by Railway; distinguish preview from live UI.
- [ ] Dev / Super Coder: task brief, project/files, execution progress, preview, errors and review/publish path.
- [ ] Creator: prompt, assets, preview, iterations and export.
- [ ] Personal: useful starting task, saved context and simple navigation.
- [ ] Shared dialogs/settings: labels, consistent actions, focus, escape/dismissal, density and solid surfaces.
- [ ] Cross-app verification: one visual language, responsive layout, keyboard focus, reduced motion and preserved functionality.

Order: shared shell and controls → CRM sections → standalone Mail → Chat → Dev/Creator/Personal → cross-app acceptance. Background personalization remains deferred.

References: https://developer.apple.com/design/human-interface-guidelines/layout and https://developer.apple.com/design/human-interface-guidelines/navigation-and-search . Veltra color and surface requirements take precedence over adopting platform-specific material treatments.

## Shared foundation increment

- [x] Code: replace generic Dev provider shortcuts with existing sourced GitHub, Vercel, Supabase, Railway and n8n brand assets, plus LiveAskew mark.
- [x] Code: remove remaining tinted sidebar/composer and translucent mode/search surfaces in the shared spatial shell.
- [x] Code: include orange and red in shared tokens and saved accent choices, preserving cyan as default.
- [x] Code: ensure common navigation/header/dialog actions have 44px minimum touch targets on coarse pointers.
- [x] Verify foundation increment with browser screenshots, branding/palette assertions, and CI before release. PR56 merged; production READY at ca068ce3f877e329775c70be03e180b953d63946.

The complete section checklist remains open; this increment does not establish that CRM, Mail, Chat or Super Coder has passed the full experience review.

## CRM customer-entry increment

- [x] Code: replace the customer-entry overlay with a native modal; focus stays within the task and returns to Add customer on close.
- [x] Code: support Escape, Cancel and a labelled close action; prevent dismissal during an in-flight save.
- [x] Code: show save errors inside the dialog and preserve entered values after a failed save.
- [x] Code: group relationship, contact and business details; retain all existing fields, validation and save operation.
- [x] Code: use opaque black surfaces, cyan focus and clear red error borders, responsive fields and 44px form controls.
- [x] Verify keyboard, failed-save/retry, mobile layout and existing CRM regression checks in both products before release. PR57 and CRM PR15 merged and production READY.

Remaining CRM review includes actual record navigation, other forms/dialogs, pipeline, sources, memory and automation. This customer-entry increment does not mark the full CRM experience complete.

## Customer navigation and pipeline increment

- [x] Code: expose customer search result counts, clear-search action, both contact name and email, and relevant outreach review warnings.
- [x] Code: focus the record title on entry and return focus to the source row/deal on Back, retaining search and pipeline stage filters.
- [x] Code: replace the squeezed six-column pipeline with a responsive 3/2/1-column board and controlled stage filter.
- [x] Code: show per-stage deal counts and separate totals by recorded currency; no currency conversion is inferred.
- [x] Verify return paths, empty search, currency separation and responsive layouts in both CRM products before release. Workspace PR58 and CRM PR16 are deployed.

Opportunity cards open the existing customer record and its opportunities. This pass does not add drag-and-drop, alter deal stages automatically, or change outreach behavior.

## Context clarity increment

- [x] Code: memory search, state filters, source and expiry, with excluded/expired facts clearly marked unavailable for customer context.
- [x] Code: distinguish Mail status loading, errors, workspace binding and actual disconnected state; disable writes when state cannot be verified.
- [x] Code: research provider-check status, selected source, request state and source-page counts.
- [x] Code: integration roadmap separated from account connection health, with sourced product logos.
- [x] Verify context states and connection failures in both CRM products before release. Workspace PR59 and CRM PR17 merged after all checks passed.

## Task-scoped AI app access — confirmed user requirement

- [ ] A new AI task must request Allow/Deny from each app it needs, even when the account is already connected.
- [ ] Allow applies only to the current task and named app; Deny blocks the requested access without disconnecting the account.
- [ ] Mail and other existing background automations continue under their existing authorization.
- [ ] Access consent remains separate from approvals to send, delete, publish or change records.
- [ ] Enforce access at the server/tool boundary; task completion, expiry or cancellation must end the grant. Show the requested purpose and an accurate receipt.

## Task-access implementation receipt

Task permissions are stored separately from connections and are scoped to the authenticated owner, task and app. New tasks ask again. The app-branded native dialog offers Allow for this task or Deny, with Deny as initial keyboard focus. App tools and direct Chat commands check permission before provider execution; normal background automation and manual app navigation retain their existing behavior. A one-hour maximum bounds abandoned tasks, and completion/end-access closes the task. Record mutation, message and publishing reviews remain separate.

Database migration and transactionally rolled-back ownership/denial/completion tests have passed on the Workspace and CRM projects. UI/API changes still require release checks; this is not yet a live permission-layer completion claim.

## Permission rollout safeguard

The user requested that existing behavior not be disrupted. Task access is therefore opt-in behind the server setting `VELTRA_TASK_ACCESS_ENABLED=true`, disabled by default. Disabled mode preserves the existing app paths and does not create grants or prompt users. Enabling production is deferred until Mail's own CRM-chat handoff and every delegated path are compatible and verified. Database tables are additive and independent of background workers. The feature must not be described as live while this rollout flag remains off.

Validation checkpoint: Workspace TypeScript check and all 62 unit/API tests passed with the opt-in flag implementation. Production activation remains deferred; standalone Mail CRM-chat compatibility and browser consent verification are still open. These passing checks do not establish that all app surfaces are ready.

## Permission verification — October 21, 2026

- [x] Workspace: TypeScript and all 63 unit/API tests pass, including the off-by-default path making zero permission-service calls.
- [x] Standalone CRM: TypeScript and all 41 tests pass.
- [x] Unmodified Mail: six focused CRM integration/sign-in/suppression/outage tests pass.
- [x] CI browser suites pass for both products: task Allow/Deny, first focus on Deny, Escape denial, new task prompts, mobile bounds, task completion, and no mocked provider execution on Deny. These are real component interactions against fixture services, not live mailbox actions.
- [x] Workspace browser navigation regression passes.
- [ ] Implement and verify Mail's own CRM-chat task handoff and remaining delegated-app paths before enabling.

Prototype review: Workspace PR60 and CRM PR18 are draft and not merged. Browser receipts: [Workspace](https://github.com/Onixus-AI/Veltra-Model-1/actions/runs/39680559082), [CRM](https://github.com/Onixus-AI/Veltra-CRM/actions/runs/39680563296). Production permission activation remains OFF. We can continue other roadmap work without activating this prototype.
