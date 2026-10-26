# Workspace Google files panel

`/settings/google` connects to the independent Google Workspace router in Mail. Deploy the Mail Google connector before this frontend. The existing `VELTRA_MAIL_URL` and Chat sign-in configuration are reused. Google client credentials stay exclusively in Mail.

The panel supports account status, OAuth, disconnect, paginated Drive filename search, bounded file previews and reviewed creation of Docs or Sheets. Sheets previews are first-tab CSV, not a full spreadsheet editor. Existing files cannot be modified by this release. Nothing is automatically ingested into Chat or sent to an AI provider.

Server scopes, callback registration, consent verification and recovery are documented in Veltra-Mail `docs/google-workspace.md`. Production callback: `https://veltra-production-5b9c.up.railway.app/chat/google/oauth/callback`.

The proxy requires the verified Workspace bearer session and forwards it only to the configured Mail backend. It allowlists paths and methods; it does not accept arbitrary Google URLs. Task-scoped calls are rejected until Google has a dedicated Chat permission and tool integration. Creation reviews use an owner-bound one-use server ticket. Google credentials and provider responses are not exposed by this frontend.

Validation: `npm run typecheck` from `apps/web`; backend security and functional boundary tests are in Veltra-Mail. Live OAuth and real file creation remain required after OAuth registration and deployment. Do not label the feature connected solely because a tile is visible.
