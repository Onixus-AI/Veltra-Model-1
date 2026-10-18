# Connected Veltra workspace

## Intended experience

Sign in to Chat with Google using Supabase Auth. Choose Enable Veltra Mail to grant Gmail access to the same Google identity. Keep chat sign-in usable without Gmail consent. Show which mailbox and workspace are connected, and provide disconnect controls. Existing email/password users must explicitly link identities through a verified session rather than creating duplicate workspaces.

Veltra Mail remains an independent product with its own Google sign-in. A Mail customer does not need a Chat account or Chat subscription. Linking an existing Mail account to Chat is optional; disconnecting Chat must preserve standalone Mail access and its mailbox connection.

## Existing Mail service

Onixus-AI/Veltra-Mail already has Google OAuth, business-specific session cookies, sealed mailbox credentials, a persistent Postgres option, approval queues, inbox and contact APIs, and account-tagged events. Its src/web.ts currently combines Google sign-in and Gmail consent and asks for Gmail modify/send/settings scopes. Its session cookie differs from Chat's Supabase session: matching email text alone is not shared authentication.

Implement an explicit account-link flow: verify the Chat Supabase JWT server-side; start a short-lived, single-use OAuth state bound to Chat user, organization, browser session and intended Mail account; verify Google identity and consent on callback; store a unique mapping from Chat user/workspace to Mail account and Google subject. Use account-scoped service authorization for Mail API calls. Never forward Chat's service-role key or Mail's global admin key to clients or model context. The Mail service should enforce the mapping on every request. Distinguish workspace membership from mailbox ownership and shared mailbox grants.

Use one Google Cloud project/brand where appropriate, with separately registered redirect URIs for Supabase sign-in and Mail connection. Ask for only identity scopes at initial sign-in; request Gmail permissions incrementally when Mail is enabled. Preserve explicit send/cleanup approvals in chat. Gmail OAuth publishing/verification status must be checked before general customer rollout.

## Connector rollout

| Connector | First useful capability | Required integration |
| --- | --- | --- |
| Veltra Mail | Read inbox, summarize contacts, draft replies and review approvals | Shared identity/account-link bridge plus account-scoped Mail API |
| GitHub | Select repositories, inspect code, propose changes as a branch/PR | Client-installed GitHub App with selected repositories and minimum permissions |
| Vercel | Inspect deployments and propose deploy actions | Per-client authorization and explicit project selection |
| Supabase | Inspect a selected project/schema and propose migrations | Per-client authorization, project selection and controlled database operations |
| Railway | Inspect selected services and logs | Per-client authorization and project/service selection |
| n8n | Run selected workflows from chat | Authenticated, allowlisted production webhooks or scoped API access |
| LinkedIn | Draft content and publish approved posts | LinkedIn OAuth and the applicable product permissions; member read access is restricted |

Keep credentials encrypted on the server, partitioned by workspace/user. Model tools receive narrowly scoped operations rather than unrestricted HTTP or raw tokens. Start with read-only tools. Require a concrete review before sending mail, posting, merging code, deploying, changing database schema, or running a consequential workflow. Record actor, target, approved action and outcome without storing secrets. Disconnect must revoke tokens where supported and invalidate stored access.

## Current implementation boundary

The UI includes a Mail connection page and read-only recent inbox view. Mail verifies Chat bearer tokens with the configured Supabase Auth /user endpoint, then issues a ten-minute, single-use authorization ticket. Google OAuth binds a second single-use ticket to the browser nonce, verifies Google issuer, audience, expiry, verified email, subject and nonce, and records the explicit Chat user → Mail account mapping. The database version prevents a pending callback from restoring a link after Chat disconnects. Mail keeps its own session and mailbox tokens; either product can remove Chat access without disconnecting Gmail.

Mail runs independently without CHAT_* variables. Production linking requires durable PostgreSQL storage. Configure CHAT_ORIGIN, CHAT_SUPABASE_URL and CHAT_SUPABASE_PUBLIC_KEY on Mail; set VELTRA_MAIL_URL on Chat. The public key is a Supabase publishable/anon key, never a service-role key. Google sign-in for Chat is displayed only when the Supabase Google provider is enabled; connecting Mail with Google also works for existing password-based Chat users. Google provider credentials and the Supabase callback must be configured separately to enable Google login to Chat itself.

This release does not add sending email through the Chat model, other external connectors or shared session cookies. Inbox reads are explicit; emails are not automatically injected into model prompts. The canvas and branding changes remain included.


## Full Mail canvas

The Connections page has a Google connector and a Veltra Mail app tile. The tile opens /?canvas=mail. The canvas loads the same built Mail frontend used by the standalone service through a same-origin frame proxy, preserving its inbox, approvals, people, folders and settings. A verified launch creates a short-lived HttpOnly, SameSite=Strict cookie restricted to the frame proxy path; the parent renews it using the current Chat session. The proxy never exposes tokens in frame URLs or JavaScript. Every Mail API request independently verifies the Chat user and current Mail link and enters the existing account-scoped Mail router. Admin and OAuth routes are excluded. State-changing frame requests require a same-origin request and a custom frame header. Google disconnect invalidates API access immediately.

Email actions remain explicit user actions in Mail’s existing UI; the Chat model does not receive new email tools or automatic mailbox context. The real Google connection is already retained; no reconnect should be necessary for existing linked users.


## Shared CRM release

Standalone CRM and Chat now use the same production Supabase project. Mail remains an independently authenticated service and links to an owner-selected CRM workspace. Its outbox publishes successful email and sent-quote activity; CRM policy lookups return approved customer memory, recent activity, open tasks and deals while enforcing suppression. Both customer-context APIs include the shared timeline. No calendar booking or automatic email permission is added by linking the products.

The CRM connector card enables the existing account's CRM view; it does not grant record permissions. Those remain in database membership policies. Use CRM's Mail connection controls to inspect pending/blocked outbox events or retry delivery. Separate unlinked legacy data is preserved.
