# Phase 1 evidence

All of this was produced on the development VM against local services. Nothing here came from
production or from a real Gmail, Stripe or calendar account (see `../integration-status.md`).

| File | What it shows | How it was produced |
|---|---|---|
| `sql-isolation.txt` | Migrations re-applied cleanly on top of themselves; tenant isolation, grants and direct-write denial pass | Local Postgres 16, `supabase/tests/revenue-isolation.sql` |
| `e2e-acceptance.txt` | 21/21: acceptance steps 1–11 and the negative tests | `test/revenue-e2e/acceptance.test.ts` with `REVENUE_TEST_DATABASE_URL` pointing at the local database, fake Gmail API, locally signed Stripe events |
| `unit-tests.txt` | 123/123 web unit tests (including 18 new revenue tests) | `npx tsx --test test/*.test.ts` in `apps/web` (the CI command) |
| `typecheck.txt` | `tsc --noEmit` exits 0 | `apps/web` |
| `operations-browser.txt` | Existing CRM browser suite still passes after the Onixus Mail/Chat rename | Same steps as `.github/workflows/operations-browser.yml` |
| `ai-gateway-unittest.txt` | Gateway tests unaffected | `python -m unittest discover` in `packages/ai-gateway` |
| `ui-browser-checks.json` | Revenue UI: no console errors; preview refuses writes; theme toggle overrides the system theme and persists; skip link is the first Tab stop; arrow keys move through the section nav; no horizontal overflow at 390 px | Headless Chrome against `next start`, `/revenue/preview` |
| `screenshots/*.png` | Overview (light and mobile dark), pipeline board (dark) and table (light), customer detail, Mail, Automation, Identity reviews | Same run. **Sample data only.** |

`next build` also completed for `apps/web`, including `/revenue`, `/revenue/paid`,
`/revenue/preview` and the four `/api/revenue/*` routes.
