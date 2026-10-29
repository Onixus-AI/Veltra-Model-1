# Onixelia internal planning pilot

This service embeds Hermes as the Onixelia operations worker. It creates internal plan proposals only. Onyx orchestrates the whole team, assigns work, steps in across all lanes, and owns Build, repair, quality and improvements; Onixa owns Grow across sales, campaigns, Signal, outreach and community; Onixelia owns Automate across workflows, schedules and handoffs. Jev provides decision support to the owning role when reviewing a plan. Onyx supplies an allowlisted aggregate snapshot and records assignments in Workspace; the snapshot excludes contact details, message bodies and connector credentials. It does not send, publish, book meetings, activate recurring schedules or debit a client wallet.

## Deployment contract

Build from the repository root with `services/onixelia/Dockerfile`. The official Hermes image is pinned by digest; its existing library interpreter is used without installing another agent framework. A fresh child process and temporary Hermes state are created for each job. The Hermes tool allowlist is empty and the child refuses to run if tools are present. The service has one execution slot, a 32-second child timeout, two maximum agent iterations and a 1,600-token output limit.

Required server-only variables:

- `ONIXELIA_TOKEN`: a generated service credential of at least 32 characters, shared only with the Workspace server.
- `OPENROUTER_API_KEY`: a **dedicated** pilot key with a cumulative, non-resetting spending cap of no more than $5. Never reuse an uncapped production key or the Mail key.
- `ONIXELIA_MODEL`: an explicitly selected model compatible with the existing OpenRouter account.
- `ONIXELIA_BUDGETED_KEY=true`: marks setup intent; the service independently checks the provider's actual key limit before every run.
- `PORT`: supplied by the host.

Workspace needs `ONIXELIA_URL` (HTTPS service origin) and the matching server-only `ONIXELIA_TOKEN`. Existing authenticated business membership is checked on every read; only a business owner can manually start a pilot. A database lock enforces one in-flight job per business and at most three starts per UTC day. Request keys prevent an HTTP retry from starting a duplicate run. The migration is `20261029193946_business_team_pilot.sql`.

Do not enable recurring execution or add client-facing charges until tenant isolation, actual model cost, replay behavior and provider receipts have been verified with the deployed runtime. Hosting is separately metered by the selected host; the $5 model-key cap does not cap hosting costs. Unknown runtime cost is stored and displayed as unknown, never zero. A Jev quality score does not authorize execution.

## Verification

- `python3 -m unittest discover -s tests/onixelia -p 'test_*.py'`
- The Workspace Node test suite includes pilot contract and database isolation/replay/quota checks.
- Production acceptance: connect the runtime, run once as the Onixus owner, verify Hermes provenance and Jev model/score, confirm three named receipts and proposed assignments, and check actual OpenRouter cost. Do not use mock success as production evidence.

## Remaining authorized work

After the pilot: industry workflows from inquiry to action, qualified lead follow-up and content publication using saved policies; measured package allowance/pricing; unify Workspace with Revenue's visual system; ensure the Onixus logo appears on all pages. The existing $299/month plus $699 setup proposal is not newly published by this implementation.

## Daily scheduling and Business Team board

The board reads the latest 100 scoped `revenue_jobs`, polling every ten seconds while visible. Only a source `succeeded` job is shown complete. Provider acceptance and delivery are separate facts; a successful internal draft is not a sent email. Older source jobs without named agent provenance retain their source-worker attribution.

Migration `20261029203000_team_daily_schedule.sql` adds owner-controlled, default-off daily planning. The cron claims at most one due business per pass, once per UTC date, shared with the three-run daily pilot cap. An owner who loses membership cannot keep scheduling work. Pause stops future claims; it does not interrupt a request already executing. A failed run consumes that day's automatic claim to prevent retry spend loops.

Daily planning currently checks a bounded sample of operational job health and creates reviewed proposals. It does **not** automatically repair jobs, publish campaigns, send messages or update shared industry playbooks. Those require supported execution handlers, business authorization and outcome receipts. No private client information is shared between businesses. Runtime hosting/key activation remains pending; do not enable schedules before a verified end-to-end provider run.
