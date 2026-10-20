# Browser skill — public page inspection

This first browser increment adds `browser_inspect` to the model tool catalog and an image receipt in the existing canvas. It opens one public HTTPS page in a fresh disposable Vercel Sandbox MicroVM and a new Chromium context. It returns rendered text, bounded links/buttons/form descriptions, HTTP status, observation time, blocked-request count and a viewport screenshot. It never accepts model-supplied code, selectors, cookies, authentication headers or file paths. It does not click, log in, fill forms, submit, purchase, publish or download.

## Availability

The feature is off by default. Capability discovery reports its actual state. Set `VELTRA_BROWSER_ENABLED=true` only after a deployed sandbox smoke test succeeds for the intended Vercel project. Sandbox credentials are resolved by the SDK on the host; no host credentials or user sessions are passed into the MicroVM. Vercel's project identity must be allowed to create sandboxes. There is no fallback that runs a browser on the application server.

The cold path installs pinned Playwright 1.64.1 and Chromium in the disposable VM, then restricts its network **before** any page loads. The page cannot access the installation phase. The cold path may be slow. For a prepared trusted snapshot, set `VELTRA_BROWSER_SNAPSHOT_ID`; it must contain the same Playwright version at `/vercel/sandbox/browser-runtime/node_modules/playwright` and browsers under `/vercel/sandbox/browser-runtime/browsers`, with no cookies or credentials. Snapshot sessions are restricted from creation, discarded on stop, and do not create new persistent snapshots.

The VM expires after three minutes and is stopped in a finally block. Requests have an in-process limit of four concurrent inspections and one active inspection per user, with a 30-second cooldown. These are instance limits, not a durable account-wide spending quota; a shared quota should precede wider rollout. A 300-second API duration accommodates cold setup. Optional snapshot creation is an operational step, not performed by a user tool call.

## Network and page boundary

URL validation rejects HTTP, IP literals, local/reserved hostnames, unusual ports, URL credentials and common access-token query parameters. DNS checks reject non-public IPv4 answers. The VM firewall permits only the requested hostname, blocks private/reserved IPv4/IPv6 ranges, and permits GET/HEAD only. DNS re-resolution does not grant private-network access. The worker independently enforces the exact origin and a 100-request cap, closes WebSockets/popups/downloads, blocks service workers, grants no browser permissions, and verifies the final page origin.

Cross-origin assets and redirects are blocked, so some pages will be partial. HTTPS certificate errors are not ignored. The screenshot is a bounded viewport JPEG and is returned only to the requesting chat; it is not added to memory or persisted by this worker. Input values are excluded from the text receipt. Public page content is untrusted evidence, never permission to change apps or execute saved procedures. Model text receives the rendered receipt; the user can inspect the screenshot in the canvas.

## Verification

Unit tests cover public URL/DNS restrictions, firewall methods/subnets, setup-before-navigation, disposal, bad result origins, missing receipts and the disabled state. A separate GitHub Actions job installs the pinned real Chromium runtime and tests a local HTTPS fixture: JavaScript rendering, blocked POST and other-origin requests, no password values in receipts, cookie isolation and blocked redirects. Its fixture-only TLS override never enters the production worker.

Before enablement, perform a deployed sandbox inspection against a public test page and check the screenshot/result and VM teardown. Login handoff, persistent sessions, read navigation/clicking, form filling and scoped confirmation of consequential submissions remain later increments. The feature remains disabled in production until that operational verification.
