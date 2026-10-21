# Combined task-access verification

Run from `apps/web` with local checkouts of all three permission branches and installed dependencies:

```sh
VELTRA_MAIL_SOURCE=/absolute/path/to/Veltra-Mail \
VELTRA_CRM_SOURCE=/absolute/path/to/Veltra-CRM \
VELTRA_ESBUILD=/absolute/path/to/esbuild \
node test/integration/combined-task-access.mjs
```

Use esbuild 0.25.12 and the dependency versions in each repository's lockfile. The script builds temporary server entry points under each checkout's `work/task-access-integration` directory; these generated files must not be committed. It is explicit rather than part of the ordinary unit-test glob because it requires sibling checkouts.

It runs Mail's real HTTP server, encrypted CRM-session proxy, the Workspace and standalone CRM task and assistant routes, the Workspace direct-chat route, and the real Supabase SDK. The identity endpoint, task RPC and table responses are in-memory fixtures. Every unexpected outbound destination fails the test. No live mailbox, database credentials or deployment configuration are used or modified.

Checks: per-app Allow/Deny, denial remaining denied, no customer reads before access, separate shared-brain permission, preview without mutation, explicit single-use confirmation, Mail attribution on the saved proposed memory, completion, expiry and unchanged disabled behavior.

This complements the component browser suites and transactional SQL ownership tests. It does **not** establish live OAuth/Data API/RLS availability or replace a signed-in hosted-preview smoke test.
