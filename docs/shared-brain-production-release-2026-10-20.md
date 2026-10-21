# Shared brain production release — 2026-10-20

Merged and deployed:

- Chat PR #45 → main `57635814a23a30bb13e8659e3d4d7d0bfc706162`, Vercel production `dpl_DkgQcRYTJ4fzfZHfnENKGWFvv2oq`, https://veltra-model-1.vercel.app
- CRM PR #9 → main `a11fb9ddb82a41739dda671ff98b1447460d73c0`, Vercel production `dpl_D74qLCjMH7AHVQ3DbtowVNu61KWj`, https://veltra-crm-gamma.vercel.app
- Mail PR #25 → main `71e877d64f09861b80f0507377cb4b58db825a6c`, Railway production `a8ae43a9-9d3c-4549-b76b-621f3fe92735`, https://veltra-production-5b9c.up.railway.app

All PR checks passed before merging. Each production deployment reported success/ready at its exact merged revision. The Mail release includes the preceding Mail-to-CRM chat work from PR #24.

Verified the public Chat and CRM application bundles both use the canonical Veltra-Model-1 Supabase identity project `cohmkgctiqcedkuisbqh`. Applied the reviewed `shared-brain.sql` there as migration `veltra_shared_brain`. The older separate CRM project was left unchanged. Verified the new table has RLS enabled, four policies, one revision/scope trigger, signed-in table access and no anonymous SELECT grant. Supabase security advisors reported no finding for the new memory table or trigger; pre-existing project-wide findings were not changed by this release.

Live checks confirmed the new Chat tool and CRM assistant endpoints reject unsigned requests, and the deployed Mail bundle contains shared-brain controls and commands. Local/hosted tests cover the authenticated action paths and database isolation. A real user-session acceptance run across all apps has not been performed from this development session; production verification did not send mail or commit customer-memory test data.

The separate browser-inspection branch is a later increment and remains disabled by default. This production release does not enable browser actions.
