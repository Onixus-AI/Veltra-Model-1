# Client-owned Workspace onboarding

This change does not migrate Signal users or create accounts using an administrator's password. Signal and Workspace remain separate authentication systems. Workspace access requires the client's verified email. Signal linking additionally requires proof from the client's existing Signal login.

## Operator flow

1. In CRM → Connections → Client access, enter the business name, industry and existing client login email. Prepare client invitation creates a seven-day pending request, not a Workspace or an outgoing email. Repeating a pending request reuses its ID.
2. Copy the invitation link and share it with the intended client through an authorized channel. No email delivery service is assumed and this feature never claims an email was sent.
3. The client opens `/workspace/join`, signs in with the invited email, and verifies it. Google sign-in and email sign-in links return to the acceptance page. Configure the production `/workspace/join` path (and query variants) in Supabase's allowed redirect URLs. The sign-in-link option allows creation of a Workspace identity if the client only has a Signal identity; credentials are never copied across products.
4. The client explicitly selects an existing Workspace they own or chooses a new one. Acceptance atomically creates/reuses that workspace, assigns the client ownership, grants the inviting agency CRM member access, and records the receipt. Replaying acceptance returns the same Workspace. Creating a new one is never the default selection.
5. In Connections the client authorizes their own mailbox using the existing Mail flow, then links it. No agency mailbox or credentials are inherited by this feature. CRM member access includes synced CRM messages; the acceptance screen discloses that scope.
6. In Existing Signal business, the owner opens Signal's `/connect-workspace?workspace=<workspace UUID>` page. They use their existing client login and generate a 10-minute connection code, then paste it into Workspace. The two verified login emails must match. The code is not a password or session token and must not be pasted into support chat.
7. The client can remove agency membership in Workspace access. Invitation revocation only cancels pending acceptance; it does not revoke previously accepted membership. Disconnecting Signal only removes the local identity link and does not delete the Signal business, content or followers.

## What the Signal link does

Stores a verified business identity and a navigation link. It does **not** import Signal campaigns, mirror brand assets, authorize publishing, transfer account ownership, or enable cross-service API access. Those require separately scoped product capabilities. Existing Signal operations continue unchanged.

Signal uses a cryptographically random code stored as a SHA-256 digest in a private RLS table. A new code invalidates the client's previous code. Consumption is atomic and bound to the destination Workspace and the issuing client's verified authentication email. Only the client's own `client_profiles.id = auth.uid()` profile can issue a code; an administrator cannot issue a code for another client. Workspace's server validates the provider receipt and commits via a server-only RPC that locks the Workspace row and rechecks ownership and verified email. Unique constraints prevent linking the same Signal client to two Workspaces. Neither UI nor public clients can write connection receipts directly.

## Production activation — not completed by preparing this change

- Correct projects: Workspace `cohmkgctiqcedkuisbqh`; Signal `rjwbfkuzgusaoizcmmgf`. Do not use a client's independent application database.
- Confirm the existing Workspace `crm_workspaces` and `crm_memberships` contract matches the migration dependencies. The local test fixture uses the previously inspected CRM contract; it is not a fresh production inspection.
- Apply Workspace's `20261027161747_client_workspace_onboarding.sql` and Signal's `20261027161750_workspace_connection_codes.sql` through their respective deployment processes. Run project security advisors afterward. Definer helpers use fixed empty search paths, explicit identities and narrow grants, and live in private schemas.
- Configure Workspace server-only `SUPABASE_SERVICE_ROLE_KEY` for the **Workspace** project. Never prefix it with `NEXT_PUBLIC_` or send it to a browser. Configure `SIGNAL_SUPABASE_PUBLISHABLE_KEY` using Signal's public project key. No Signal service-role key is required.
- Set Workspace Auth site URL and redirect allowlist to the production origin, including `/workspace/join` query variants. Verify Google and email OTP sign-in plus authenticated email confirmation/SMTP delivery. Signal client login's `next` parameter is restricted to this connection page and UUID format; arbitrary external redirects are rejected.
- Deploy Signal's connection page and code RPC before enabling the Workspace connection action. Verify both CI pipelines and previews; do not bypass blocked required checks.
- Run a controlled end-to-end acceptance using separate test identities in the actual projects: agency prepares, client verifies/accepts, ownership and membership visible, client Mail links correctly, Signal code links correct client ID, other tenant denied, agency removal enforced. Do not connect a live client's mailbox as a smoke test.

Database access, secret provisioning and production migrations were unavailable during implementation. No live client invitations, accounts, mail authorizations or links were created.

## Validation

- `apps/web/test/client-onboarding.test.ts`: disposable PostgreSQL (PGlite), actual migration, anon/authenticated/service roles, pending request reuse, ownership, wrong-email rejection, expiry/revocation, idempotent acceptance, existing Workspace reuse, tenant isolation, agency removal, forged receipt denial, atomic receipt commit, one-Signal-client constraint and provider receipt validation.
- Signal `tests/workspace-connection.test.mjs`: real SQL code issuance/consumption, verification requirement, profile ownership, private storage, single use, expiry, wrong destination/email and rotation.
- `apps/web/test/browser-onboarding`: isolated UI fixture with fictional identities; no real data or outbound email. It is not a production identity/provider test.

## Production email readiness

The production dashboard currently reports Supabase's built-in email service, not a custom SMTP sender. Google sign-in remains the supported client invitation path. The email-link shortcut is hidden unless `NEXT_PUBLIC_CLIENT_EMAIL_SIGNIN_ENABLED=true`; enable it only after custom SMTP and actual external-recipient delivery are verified. Mailbox authorization is separate from Workspace sign-in.
