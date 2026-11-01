# Onixus workspace foundation

## Product rules

1. A workspace is where people do their work. Tools remain available without asking Onyx.
2. One navigation definition supplies names, destinations and business context. Tool views belong inside their tools.
3. Presets change suggestions, not the selected business or open work.
4. The default entry opens Overview; explicit tool/chat links remain supported.
5. Customization hides navigation entries, never deletes records or grants permissions.
6. One appearance applies to native workspace tools. Embedded documents load the same preferences.
7. Reuse existing services. Remove code only when its replacement covers its callers.

## Design foundation

The existing dark identity is retained: background #000000, surface #111214,
border #343434, text #f4f4f5, secondary text #b8b8bf and cyan #00e5ef.
DM Sans is the shared interface typeface, with a 14px body and restrained headings.
Controls use an 8px radius and a 40px minimum height (44px for coarse pointers).
Compact density is optional. Light appearance uses darker accents for legibility.
Content is left aligned; the workspace rail is stable, while each tool controls
its own useful layout. No new decorative effects or component framework.

## Implementation boundaries

- `lib/workspace-navigation.ts`: browser-independent metadata, URL construction,
  context parsing and preference validation. Reusable outside React.
- `components/workspace-navigation.tsx`: native links and a small tool-selection
  dialog. Root workspace can intercept known tools to retain open CRM/Mail panels.
- `components/workspace-frame.tsx`: shared navigation around native standalone
  pages. It excludes public pages and frames, preventing nested host navigation.
- `lib/workspace-business.ts`: a navigation preference and change notification.
  This is NEVER proof of membership. Existing API authorization and database
  policies remain responsible for data isolation.
- `styles/veltra-theme.css`: canonical tokens with compatibility aliases.
- `styles/workspace-foundation.css`: shared host, dialogs and native controls.

Workspace tool ordering/name and appearance now save to the authenticated user's
Supabase metadata through GET/PUT `/api/workspace/preferences`. The two versioned
keys are independent; appearance saves cannot overwrite tool layout. These fields
are preferences only and MUST NOT determine roles, memberships or access.

The route verifies the bearer with Supabase, rejects anonymous/API-key access,
checks the expected user, limits payload size and updates only the selected key
using that same request bearer and public key. It never accepts an arbitrary
account endpoint or uses an admin credential. It verifies the persistence receipt
before reporting success. GET responses omit unrelated account metadata.

The shared provider serializes saves, ignores stale reads and receipts, clears
state on account changes and refreshes on focus, visibility and cross-tab signals.
Different devices use last-write-wins per section; this is not collaborative editing.
Failures stay visible with retry controls. Old browser layout is imported only
when the user explicitly requests it. Browser-only fallback applies when Supabase
is unconfigured. The cached business selection is cleared on account changes;
services still enforce membership for explicit business URLs.

CRM uses the existing workspace session. Its redundant nested login form has
been removed; this does not merge the separate client-site authentication system.

## Headless direction: keep services independent

Existing API routes remain the service boundary. Do not add a second backend or
move business rules into navigation components. A new tool should call the same
authorized service from the workspace, another UI, automation or an agent.

Adding a first-party view today:

1. Add its stable ID, name and route to `workspaceTools`.
2. Supply its icon in `workspace-navigation.tsx`.
3. If it can open in the existing canvas, add the host adapter and an explicit
   handler. Otherwise its route opens normally; do not create unused abstractions.
4. Use shared appearance tokens, labeled controls, loading/error/empty states and
   keyboard access. Preserve business context and verify membership server-side.
5. Add a behavior test for context and a browser walkthrough for the real view.

## External developer support: remaining work, not advertised as shipped

A general third-party extension SDK and custom MCP installation are not enabled
by this UI refactor. They need an authenticated installation lifecycle, reviewed
scopes, credential storage, revocation, audit records, and server-side endpoint
validation before accepting remote servers. MCP capabilities and UI panels are
separate extension types; a connector does not automatically supply an interface.

Before exposing third-party access:

- Inventory and document existing API contracts, authentication, role checks,
  pagination and error responses; identify missing stable contracts.
- Add scoped credentials and versioning to existing services where necessary.
- Provide one working connector example and one accessible panel example.
- Add install, disable, revoke and update flows with clear workspace scope.
- Specify events/webhooks with delivery, retry and idempotency behavior using
  existing job infrastructure where suitable.
- Verify cross-business isolation, revoked access and malicious endpoints.

Do not claim one login across the marketing/client site and this application
until their separate authentication systems have a tested migration path. Do
not delete Relay CRM, database records or working integrations as visual cleanup.

## Release checks

Type-check, production build and focused navigation/preference tests; then browser
walkthroughs at desktop and mobile sizes: navigate between native tools, preserve
the business in CRM, change a preset without closing work, save/reorder/hide tools,
restore preferences after reload, change appearance, use search, close dialogs by
keyboard, and ensure embedded CRM has no nested workspace navigation.

Authenticated production integrations require a separate live-account walkthrough.
A fixture-based browser check is not evidence that external accounts or services
are configured or that the system can support 2,000 clients.

## Account migration audit — next required work

Workspace and client/Signal use different Supabase projects. Existing Signal launch
and embed routes already implement a gated one-time handoff. Keep that feature
flag unchanged until both projects can be inspected and the full journey tested.
The current connector exposes only an unrelated inactive Zeevents project.

The client-site baseline contains a hardcoded identity/client exception in its
Workspace–Signal bridge. Replace it only after auditing actual auth identities,
business memberships and connection mappings. Email equality is not proof of
membership. Preserve current users and data while migrating verified mappings.
Do not merge the earlier unapproved client-site login draft as part of this work.

Required release proof: sign in once, enter the correct business, follow Build or
Growth, move Build to Growth without a second identity, deny other businesses,
expire/revoke a handoff, and sign out across the intended session boundaries.
No live sign-in migration or capacity claim is established by this checkpoint.

## Build and Growth pathways

`/workspace/build` and `/workspace/growth` are client pathways inside the same
Workspace shell and authenticated session. They are distinct from Super Coder's
existing `build` canvas. Overview links to both; the shared navigation exposes
Build & Growth, and both routes keep the same navigation selection.

A shared component reads the existing authenticated CRM business list. It shows
actions only for a selected business present in that response, resets on account
changes, and provides loading, empty and retry states. Pathway switching and all
tool links carry the selected business. Existing API membership checks remain
authoritative; route visibility is not a new entitlement or role.

Build points to website, brand, customer intake and connections. Growth points
to leads, follow-ups, Signal campaigns and Overview. Both provide a direct route
to the other pathway with the same business. They do not automatically classify
a client, certify a website, track completed onboarding steps, or change billing.
Readiness and paid service assignment require verified business data, which has
not yet been audited in the inaccessible live projects.

The navigation cache account-reset notification now restores explicit URL
context after clearing account-local cached state. This fixes the first-load
case where the page retained its business but the shared sidebar lost it.

## Account boundary for mounted tools

AuthGate keys the protected application subtree by the signed-in user ID.
Changing accounts remounts tool state; refreshing the same account's token does
not discard open work. This boundary depends on session identity, not preference
metadata or a successful preference save/load.

The initial getSession result is ignored after a newer auth event. Rejected
initial reads show a sign-in error instead of an indefinite loader. Auth events
remain observed on public pages so signing out there cannot leave the protected
workspace using a stale identity when the user returns. Server-side identity
verification and business membership checks remain the authorization boundary.

## Tool journey consistency

Overview tool cards now use the same workspaceHref builder as the shared sidebar
and Build/Growth pathways. Connected tools and connection-setup destinations keep
the selected business explicitly in their URLs, including after business changes.
Brand files links back to Overview/Docs and the website editor's return link use
the same builder. Brand files remain account-private; carrying a navigation
business ID does not change their storage scope or authorization.

Brand files now distinguishes loading, failure and successfully loaded empty
results. A retry control and 15-second list deadline prevent a failed/stalled
request from presenting an empty folder. File operations are disabled while the
list is loading, and navigation/filter controls wrap at narrow widths.

The website editor still requires export/download to keep edits; these navigation
repairs do not add publishing, automatic save or business-scoped website storage.
