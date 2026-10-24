> Repository publishing is paused by default. Generated files remain reviewable; PR creation requires operator opt-in. Chat source evidence is read-only and test plans are not executed tests. See [self-development.md](self-development.md).

# Veltra Build: bounded coding team

Veltra Build is an additive `/build` workspace. Existing Chat, its embedded CRM, Mail and the separate standalone CRM remain independent entry points. The main Chat conversation request format is unchanged.

## Task flow

An authenticated user submits a task and an idempotency ID. The gateway atomically reserves 6,000–20,000 Veltra credits (the API allows 1,000–20,000), queues the job and returns a receipt. A gateway worker claims it and executes a bounded LangGraph:

1. Optional Qwen vision describes the submitted screenshot.
2. DeepSeek plans from the task and reference code.
3. Qwen builds reviewable files and optional browser actions.
4. DeepSeek independently reviews the proposed files.
5. If requested and the review passes, the image tool creates one project asset.

There is no unbounded agent conversation or automatic retry loop. Text steps use reported token usage; one generated image costs 100 Veltra credits. Credits are internal accounting units, not OpenRouter dollars. A provider balance and usable model endpoints are still required.

Each stage persists outputs and usage receipts. Unused reservation returns atomically after settlement. Stop requests take effect at a safe boundary, after any already-running provider call. A worker restart or uncertain provider usage marks the task interrupted and keeps its reservation visible for reconciliation instead of silently re-running a paid call. This first version does not automatically resume interrupted paid steps.

## Tools and boundaries

- Read reference code from the existing connected repository selector; no tokens enter model prompts.
- Attach a screenshot or explicitly capture one browser-shared screen frame. There is no continuous hidden screen capture.
- Create 1–12 proposed files with relative, non-secret paths.
- Create one image as a separately downloadable asset (`assets/generated.png`).
- Run checks through `/api/build/verify` in an ephemeral Vercel Sandbox, never the gateway host.
- For a self-contained `index.html`, the isolated browser renders the page, performs bounded click/fill checks and captures a screenshot. External-site navigation is blocked.
- Browser dependencies are installed before generated code runs, with registry-only egress. Egress is denied before rendering or executing generated tests. Host credentials are not passed into the VM. The VM stops in `finally`. Each completed task has at most two server-enforced sandbox attempts, bounded to three minutes and one vCPU each. A completed verification cannot repeat; an infrastructure failure can retry within that limit.
- Model review, executed syntax checks, test results and browser evidence are labeled separately. A passing check does not establish full functional correctness.
- Completed coding tasks can review all generated text files together and create one atomic commit and draft PR in the selected repository. Chat can read exact-head CI/preview receipts with github_pr_checks. See self-development.md. No automatic merge, production deployment, arbitrary external-app control or paid integration purchase is enabled.

## Setup and deployment

Apply the generated `agent_runs` migration to the Veltra Chat Supabase project. It adds an RLS-protected job table and service-role-only queue/reservation/settlement functions. It does not change CRM data or subscription prices.

Install `packages/ai-gateway/requirements.txt` and deploy the gateway source with its existing server-only OpenRouter and Supabase credentials. `VELTRA_CODING_TEAM_ENABLED=false` disables new jobs and the worker. Role routes default to existing DeepSeek and Qwen models; `VELTRA_PLANNER_MODEL`, `VELTRA_CODER_MODEL`, `VELTRA_REVIEWER_MODEL`, and `VELTRA_VISION_MODEL` override provider IDs on the server.

The web deployment needs its existing gateway URL and user authentication configuration. Vercel Sandbox uses deployment OIDC, or explicitly supplied server-only `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, and `VERCEL_PROJECT_ID` outside Vercel. Sandbox availability and infrastructure charges depend on the connected Vercel account; a local build does not prove hosted Sandbox access.

The current standalone CRM and Chat have separate Supabase projects. Do not pass customer IDs between them until shared identity/record mapping is established. CRM-only clients can use their own CRM interface without using Chat.

## Validation

```sh
python -m unittest discover -s packages/ai-gateway/tests -v
# Requires @electric-sql/pglite available to Node (or PGLITE_MODULE set).
node packages/ai-gateway/tests/database.mjs
npm --prefix apps/web run typecheck
npm --prefix apps/web run build
```

Tests cover collaboration order, cross-user/org API scoping, cancellation, uncertain usage, file/action validation, reservation idempotency, database read isolation and refunds. They stub model calls and do not claim live provider, authenticated browser or hosted Sandbox verification.
