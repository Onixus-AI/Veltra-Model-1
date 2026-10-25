# Revenue system evidence

All of this was produced on the development VM against local services. Nothing here came from
production or from a real Gmail, Google Calendar or Stripe account (see `../integration-status.md`).

| File | What it shows | How it was produced |
|---|---|---|
| `sql-isolation.txt` | All four migrations applied, then re-applied on top of themselves; tenant isolation, grants, direct-write denial and the relay/calendar RPC token checks pass | Local Postgres 16, `supabase/tests/revenue-isolation.sql` |
| `e2e-acceptance.txt` | 26/26: acceptance steps 1–11 (send, reply and meeting go through the Onixus Mail relay code) and the negative tests | `test/revenue-e2e/acceptance.test.ts` against the local database, fake Gmail and Calendar APIs, locally signed Stripe events |
| `routes-and-chat.txt` | 8/8: HTTP route tests (authentication, workspace isolation, roles, validation, error shapes, provider callbacks, cron) and Chat wiring tests (authorized context only, previews and confirmations, never sends, untrusted email cannot act) | `test/revenue-e2e/routes.test.ts` and `chat.test.ts`: unmodified route handlers, supabase-js, a local PostgREST v12.2.3, a local JWT check in place of Supabase Auth, and a fake model gateway |
| `unit-tests.txt` | 123/123 web unit tests | `npx tsx --test test/*.test.ts` in `apps/web` (the CI command) |
| `typecheck.txt` | `tsc --noEmit` exits 0 | `apps/web` |
| `operations-browser.txt` | The existing operations, setup and workspace browser suites still pass | Same steps as `.github/workflows/operations-browser.yml` |
| `ai-gateway-unittest.txt` | Gateway tests unaffected (Phase 1 run; the gateway was not changed since) | `python -m unittest discover` in `packages/ai-gateway` |
| `ui-browser-checks.json`, `screenshots/*.png` | Revenue UI checks and screenshots, **sample data only**. Produced in Phase 1 and not re-run after the "Google Calendar: <status>" freshness row was added. | Headless Chrome against `next start`, `/revenue/preview` |

`next build` also completed for `apps/web`, including `/revenue`, `/revenue/paid`,
`/revenue/preview` and the five `/api/revenue/*` routes (the calendar endpoint is new).

The Onixus Mail side (Veltra-Mail#39) has its own results: `npm run typecheck`, `npm test`
(132/132, of which 8 are relay tests) and the web build, run locally on the same VM.
