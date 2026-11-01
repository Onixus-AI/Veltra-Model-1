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

Workspace tool ordering/name and appearance are browser-local preferences. They
are not yet account-synced workspace configurations. Existing local keys are
retained where useful so a UI cleanup does not silently discard preferences.

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
