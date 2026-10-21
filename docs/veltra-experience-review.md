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
- [ ] Verify foundation increment with browser screenshots, branding/palette assertions, and CI before release.

The complete section checklist remains open; this increment does not establish that CRM, Mail, Chat or Super Coder has passed the full experience review.
