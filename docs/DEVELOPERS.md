# Onixus Workspace developer entry point

The existing HTTP services are the boundary between Workspace UI and business
operations. This is an integration baseline, not a released third-party SDK or
a general MCP installation system. No new backend is required for this example.

## Run the read-only example

From the repository root, run:

```sh
node examples/read-only-business/read-overview.mjs --help
```

Supply these environment variables through your application's credential/session
handling or your local environment:

| Variable | Meaning |
| --- | --- |
| ONIXUS_ORIGIN | Your authorized Workspace deployment origin; HTTPS, or HTTP loopback for local development |
| ONIXUS_ACCESS_TOKEN | Your own currently signed-in Workspace user's access token |
| ONIXUS_WORKSPACE_ID | The UUID of a business available to that user |
| ONIXUS_PERIOD | Optional: today, week or month; defaults to month |

Then run `node examples/read-only-business/read-overview.mjs`.
Do not commit tokens, place them in URLs or send them to unrelated deployments.
The example does not sign in, refresh sessions, install anything, or store tokens.
It requires Node.js 22+ and uses its built-in fetch without package dependencies.
Import `readBusinessOverview` from `examples/read-only-business/client.mjs` to use
the same read in another application. The CLI prints only selected summary fields.

A gateway `veltra_sk_` key is not supported by these account/business APIs.
The API verifies the user and business membership; a business UUID or matching
email by itself does not grant access. Expired sessions require a fresh sign-in.

## Current source-backed contracts

| Route | Method | Scope | Source |
| --- | --- | --- | --- |
| /api/workspace/overview?workspace=UUID&period=month | GET | Authenticated business member | apps/web/app/api/workspace/overview/route.ts |
| /api/workspace/preferences | GET | Current account only | apps/web/app/api/workspace/preferences/route.ts |
| /api/workspace/preferences | PUT | Current account's own preference metadata only | apps/web/lib/workspace-preferences-api.ts |

Overview accepts today/week/month. It returns workspace, period, range, overview,
previous, trend, priorities, completed, tasks, jobs, team and reports. Its main
summary must succeed; optional sections can be null when unavailable. Currency,
unknown data and source observations must retain their actual meanings. Never
replace missing payment data, failed queries or unavailable sections with zero.
The example rejects a receipt for another business or reporting period.

Preferences GET returns userId, layout, appearance, hasLayout and hasAppearance.
PUT accepts only `{userId, section, value}`, where section is layout or appearance
and value uses version 1. It verifies the current user matches userId, normalizes
the selected preference and confirms the persisted response. This does not grant
roles or business membership. The two metadata keys are independent.

Error responses use `{error: string}` with no-store caching. Relevant status
codes include 400 invalid input, 401 invalid session, 403 denied membership,
409 changed account, 413 oversized preference, 429 rate limiting, and 502/503
unavailable or unconfirmed upstream results. Do not automatically retry a write.
The read-only example makes one request, blocks redirects and uses a deadline.

These routes are currently application contracts, not a versioned public API
with a compatibility guarantee. Preserve/add explicit versioning and integration
tests before offering a supported public developer API.

## Add a workspace view

Reuse shared appearance tokens and the existing frame. Add a stable navigation
entry in apps/web/lib/workspace-navigation.ts and an icon in its renderer. Keep
business IDs in tool links and enforce membership again in the server service.
Provide labeled controls, keyboard support and loading, empty and failure states.
Pathway metadata is independent of React in apps/web/lib/workspace-pathways.ts.
Do not duplicate CRM data or implement permission decisions in UI components.

## MCP and Cloudflare evaluation

Cloudflare MCP Server Portals can aggregate upstream MCP servers behind one
endpoint. Code Mode can expose typed operations through a code tool or search
and execute tools, with generated programs running in isolated Workers. These
are candidates for a later connector layer; this checkpoint installs neither.

Keep the existing Onixus API as the business authorization boundary. A portal
login does not establish Onixus membership, and a sandbox does not make an action
authorized. Start with the read-only overview example and validate tenant scope
before evaluating writes. Custom panels and MCP connectors remain distinct.

Before a multi-client rollout, design per-user/per-business credential handling,
scopes, install/revoke flows, approvals, endpoint validation, audit records,
usage limits and real-account isolation tests. Confirm provider capabilities and
costs before committing to a hosting change. Code Mode is currently documented
as experimental.

Official sources checked 2026-11-01:
- https://developers.cloudflare.com/cloudflare-one/access-controls/ai-controls/mcp-portals/
- https://developers.cloudflare.com/agents/model-context-protocol/guides/build-codemode-mcp-server/
- https://developers.cloudflare.com/agents/concepts/tools/

## Verification limits

Run `node --test examples/read-only-business/client.test.mjs` from the repository root.
Adapter tests use fixture HTTP responses to verify scope, errors and preservation
of unknown results. They do not demonstrate a live deployed integration. The two
Onixus projects still reject read access through the current Supabase connector.
No production credentials, schema, authentication settings or hosting changed.
