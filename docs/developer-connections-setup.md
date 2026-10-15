# Veltra developer OAuth setup

Clients connect their own GitHub, Vercel and Supabase accounts from Chat → Connections. Google Mail authorization is separate. Tokens stay encrypted in the Mail backend database and are never returned to the browser.

## Register provider applications

Register applications owned by Veltra and configure these exact callbacks:

| Provider | Callback | Railway Mail environment variables |
| --- | --- | --- |
| GitHub OAuth App | https://veltra-production-5b9c.up.railway.app/chat/oauth/github/callback | WORKSPACE_GITHUB_CLIENT_ID, WORKSPACE_GITHUB_CLIENT_SECRET |
| Vercel integration | https://veltra-production-5b9c.up.railway.app/chat/oauth/vercel/callback | WORKSPACE_VERCEL_CLIENT_ID, WORKSPACE_VERCEL_CLIENT_SECRET, WORKSPACE_VERCEL_INTEGRATION_SLUG |
| Supabase OAuth App | https://veltra-production-5b9c.up.railway.app/chat/oauth/supabase/callback | WORKSPACE_SUPABASE_CLIENT_ID, WORKSPACE_SUPABASE_CLIENT_SECRET |

GitHub requests `repo` and `read:user` to read repositories and create branches and draft pull requests, including private repositories. Vercel needs read access to Projects and Deployments. Supabase needs read access to project metadata; this release does not query database contents or execute SQL. Configure provider application permissions accordingly.

Enter secrets privately in Railway's Mail service environment. Keep the existing SESSION_SECRET stable; it encrypts stored connections. Restart/redeploy Mail after changing variables. Chat uses its existing VELTRA_MAIL_URL and Supabase session authorization.

Until application credentials are configured, each provider card shows “Veltra setup required” and disables authorization. App registration and a real consent round trip are required before calling the integration live.

## Client flow

1. Choose Connect on a provider card and approve access on the provider website.
2. Choose an authorized repository or project.
3. Open the developer workspace. GitHub files open in the code canvas; clients can ask Veltra about a file or insert generated code into the editor.
4. Review original and edited contents, supply a title, then explicitly create a draft pull request. Changes go to a dedicated branch, never directly to the default branch.
5. Vercel shows selected-project deployments. Supabase shows selected-project details and a dashboard link. Deployment creation, SQL execution and automatic merging are not implemented.

Disconnect removes Veltra's stored credentials and selection. Clients can additionally revoke the application in provider account settings. OAuth launch tickets expire after ten minutes and can only be consumed once; disconnecting invalidates pending authorizations.

## Validation

The automated provider tests use fake HTTP responses. They cover cross-user isolation, encrypted credential identity binding, OAuth state, PKCE, replay prevention, stale repository selections and idempotent draft pull request retries. Real provider credentials and consent must still be checked after registration.
