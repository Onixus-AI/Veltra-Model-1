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
`POST /v1/chat/completions`, account, and API-key management endpoints. Pass a
Supabase Auth access token or an active `veltra_sk_...` API key as a bearer
token and use one of
`veltra-free`, `veltra-fast-free`, `veltra-code-free`, `veltra-logic`,
`veltra-fast`, `veltra-agent`, `veltra-media`, or `veltra-dev` as the requested
model. API keys are looked up by their SHA-256 hash in Supabase. User access
tokens are verified with Supabase Auth, and the organization is read from
`app_metadata.org_id` or `app_metadata.organization_id`. Requests are rejected
with HTTP 402 when the organization has no credits.
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
`http://localhost:8000` by default. Set `AI_GATEWAY_URL` or
`NEXT_PUBLIC_VELTRA_API_URL` in the web server environment to use a different
gateway. The browser automatically forwards the access token from the standard
Supabase Auth local-storage session. Developer API keys remain available for
external tools and as a browser fallback. `/settings` contains rolling usage
analytics, key management, and the subscription view; `/settings/keys`
redirects there for compatibility.
