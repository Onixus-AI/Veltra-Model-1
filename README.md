# Veltra-Model-1
Modern LLm for Business

## AI gateway

Copy `.env.example` to `.env` and set `OPENROUTER_API_KEY`,
`SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY`. Start the gateway from the
repository root:

```sh
python -m venv .venv
. .venv/bin/activate
pip install -r packages/ai-gateway/requirements.txt
uvicorn main:app --app-dir packages/ai-gateway --reload
```

The gateway exposes `GET /health` and authenticated
`POST /v1/chat/completions`, account, and API-key management endpoints. Pass an
active `veltra_sk_...` API key as a bearer token and use one of
`veltra-free`, `veltra-fast-free`, `veltra-code-free`, `veltra-logic`,
`veltra-fast`, `veltra-agent`, `veltra-media`, or `veltra-dev` as the requested
model. The key is looked up by its SHA-256 hash in Supabase. Requests are
rejected with HTTP 402 when the organization has no credits.
The gateway prepends Veltra's identity and business-assistant instructions to
each request. One credit is deducted per reported input or output token. Model
routing is defined in
[`packages/ai-gateway/config.yaml`](packages/ai-gateway/config.yaml).

Apply all SQL files in [`supabase/migrations`](supabase/migrations) in order.
The core migration provisions each new organization with a wallet for the
$59/month Veltra Business OS plan and its 3,000-credit allocation. The simple
credit migration consolidates existing unexpired credits into
`public.credit_wallets`, removes FIFO credit lots, and installs atomic
`deduct_credits_simple` and capped `rollover_credits_simple` functions. Call the
rollover function after each successful monthly subscription renewal; each
renewal adds 3,000 credits up to the 10,000-credit wallet cap. API key records
store a hash and prefix; new keys are displayed only once.

## Web application

Install and start the Next.js workspace from the repository root:

```sh
npm --prefix apps/web install
npm --prefix apps/web run dev
```

Open `http://localhost:3000` and use the Project Knowledge drawer to add PDF or
text context. The web app proxies chat, account, and key-management requests to
`http://localhost:8000` by default; set `AI_GATEWAY_URL` in the web server
environment to use a different gateway.

For a no-prompt browser session, set `VELTRA_BROWSER_API_KEY` in the **web
server** environment (for local development, `apps/web/.env.local`) to an
active key for the intended organization. The server injects it into gateway
requests; it is never sent to the browser. Do not expose the web app publicly
without protecting access to that shared organization. Developers may still
provide a personal key in browser session storage. `/settings` contains
rolling usage analytics, key management, and the subscription view;
`/settings/keys` redirects there for compatibility.
