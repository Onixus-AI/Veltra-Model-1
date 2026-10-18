# LiveAskew / Bee connection

Bee appears under Business OS in Connections with LiveAskew's existing app icon (copied from harrisoma/Liveaskew public/icons/icon-192.png). First-time members use the Create LiveAskew account / sign in link, then return to Veltra and choose Connect Bee. Veltra does not create a LiveAskew account on their behalf.

Deploy the matching Veltra-Mail server changes before this web change. The existing VELTRA_MAIL_URL, Chat authentication and durable connection store must be configured. No new provider secret is required: Bee registers a public PKCE client with LiveAskew. The callback is the Mail origin plus /chat/bee/oauth/callback. LiveAskew must have its existing MCP OAuth tables and API deployed.

Supported explicit Chat requests:

- Ask Bee: What should I wear?
- Show my Bee looks / Show my saved Bee looks
- Show my Bee calendar / Show my Honey calendar
- Get my Bee daily overview
- Is Bee connected? / What can Bee do?

Only the latest user message selects a tool. Retrieved content cannot trigger one. Bee's response is displayed directly, not rewritten by another model. Advice can consume the member's LiveAskew allowance. These tools do not expose outfit creation, calendar changes, try-on or publishing. No general autonomous tool-selection loop is added.

The connection is scoped to a Veltra user authorizing a LiveAskew member; it grants no workspace-wide access. Tokens stay encrypted in Mail. Disconnect removes local access; members can additionally revoke provider access in LiveAskew.

Validation: connector OAuth/isolation/refresh/disconnect test and Chat intent/stream tests pass with mocked LiveAskew. Strict TypeScript check passes for the server connector and its test. Full application builds were not completed because the local machine ran out of disk during dependency installation. No real member authorization or billable Bee call was performed. Live acceptance still needs signup/sign-in, consent, all four tools, membership denial, expired authorization and disconnect in a deployed browser.
