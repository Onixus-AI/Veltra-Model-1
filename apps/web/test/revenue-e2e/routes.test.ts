// HTTP route tests for /api/revenue/*. The unmodified Next.js route handlers run through
// supabase-js against a real PostgREST (the server Supabase uses) on the local revenue database,
// so authorization, workspace isolation, validation and error shapes are tested end to end. Only
// Supabase Auth's /auth/v1/user is replaced, by a local HS256 check of the same JWTs PostgREST
// verifies. Needs REVENUE_TEST_DATABASE_URL and REVENUE_TEST_POSTGREST_BIN.
import {after, before, test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn, type ChildProcess} from 'node:child_process';
import {createHash, createHmac, randomBytes, randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {pgStore, testPool} from '../helpers/pg-store';
import {GET as revenueGET, POST as revenuePOST} from '../../app/api/revenue/[...path]/route';
import {POST as calendarPOST} from '../../app/api/revenue/calendar/[integration]/route';
import {POST as formPOST} from '../../app/api/revenue/forms/[integration]/route';
import {GET as workerGET} from '../../app/api/revenue/worker/route';
import {POST as stripePOST} from '../../app/api/revenue/webhooks/stripe/route';

const bin = process.env.REVENUE_TEST_POSTGREST_BIN;
const skip = (!process.env.REVENUE_TEST_DATABASE_URL || !bin) && 'REVENUE_TEST_DATABASE_URL and REVENUE_TEST_POSTGREST_BIN are required (see docs/revenue-system/setup-and-recovery.md)';
const SUPABASE = 'https://supabase.test';
const JWT_SECRET = randomBytes(24).toString('hex');
const PORT = 3400 + Math.floor(Math.random() * 400);
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
const jwt = (claims: Record<string, unknown>, secret = JWT_SECRET) => {
  const body = `${b64({alg: 'HS256', typ: 'JWT'})}.${b64({exp: Math.floor(Date.now() / 1000) + 3600, ...claims})}`;
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
};
const verify = (authorization: string | null) => {
  const [h, p, sig] = (authorization ?? '').replace(/^Bearer /, '').split('.');
  if (!h || !p || createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest('base64url') !== sig) return null;
  return JSON.parse(Buffer.from(p, 'base64url').toString()) as {sub?: string; role?: string};
};

const O = randomUUID(), M = randomUUID(), V = randomUUID(), X = randomUUID(), W = randomUUID(), W2 = randomUUID(), A = randomUUID();
const as = (user: string) => jwt({sub: user, role: 'authenticated', aud: 'authenticated'});
let pool: Pool, server: ChildProcess, realFetch: typeof fetch, customer: string, otherCustomer: string;
const env: Record<string, string | undefined> = {};
const setEnv = (values: Record<string, string | undefined>) => {
  for (const [k, v] of Object.entries(values)) { if (!(k in env)) env[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
};

type Call = {status: number; body: any; headers: Headers};
const read = async (r: Response): Promise<Call> => ({status: r.status, body: await r.json().catch(() => null), headers: r.headers});
const get = async (path: string, user: string | null, query: Record<string, string> = {}) => {
  const url = `https://web.test/api/revenue/${path}?${new URLSearchParams(query)}`;
  return read(await revenueGET(new Request(url, {headers: user ? {Authorization: `Bearer ${user}`} : {}}), {params: Promise.resolve({path: path.split('/')})}));
};
const post = async (path: string, user: string | null, body: unknown) => {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  return read(await revenuePOST(new Request(`https://web.test/api/revenue/${path}`, {method: 'POST', headers: {'Content-Type': 'application/json', ...(user ? {Authorization: `Bearer ${user}`} : {})}, body: raw}),
    {params: Promise.resolve({path: path.split('/')})}));
};
/** Every failure is {error: string}, never cached, and never leaks SQL or stack details. */
const failsWith = (r: Call, status: number, pattern?: RegExp) => {
  assert.equal(r.status, status, JSON.stringify(r.body));
  assert.deepEqual(Object.keys(r.body ?? {}), ['error']);
  assert.equal(typeof r.body.error, 'string');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.doesNotMatch(r.body.error, /permission denied|P0001|42501|violates|syntax|at .*\.ts|relation "/);
  if (pattern) assert.match(r.body.error, pattern);
};

before(async () => {
  if (skip) return;
  pool = testPool();
  await pool.query(`do $$ begin if not exists(select 1 from pg_roles where rolname='authenticator') then create role authenticator login password 'fixture-only-password' noinherit; end if; end $$`);
  await pool.query('grant anon, authenticated to authenticator');
  await pool.query('insert into auth.users(id,email) values ($1,$5),($2,$6),($3,$7),($4,$8)', [O, M, V, X, 'owner@routes.test', 'member@routes.test', 'viewer@routes.test', 'other@routes.test']);
  await pool.query(`insert into public.crm_workspaces(id,name,owner_id,environment) values ($1,'Routes Studio',$3,'test'),($2,'Other Business',$4,'test')`, [W, W2, O, X]);
  await pool.query(`insert into public.crm_memberships(workspace_id,user_id,role) values ($1,$2,'owner'),($1,$3,'member'),($1,$4,'viewer'),($5,$6,'owner')`, [W, O, M, V, W2, X]);
  await pool.query('insert into public.crm_mail_connections(account_id,workspace_id,token_hash,connected_by) values ($1,$2,$3,$4)', [A, W, sha(randomBytes(32).toString('hex')), O]);
  customer = (await pgStore(pool, M).rpc<{customer_id: string}>('revenue_upsert_customer', {p_workspace: W, p_customer: {email: 'lee@routes.test', name: 'Lee Park', company: 'Park Dental'}})).customer_id;
  otherCustomer = (await pgStore(pool, X).rpc<{customer_id: string}>('revenue_upsert_customer', {p_workspace: W2, p_customer: {email: 'secret@other.test', name: 'Hidden', company: 'Other Co'}})).customer_id;

  const dbUrl = new URL(process.env.REVENUE_TEST_DATABASE_URL!);
  dbUrl.username = 'authenticator'; dbUrl.password = 'fixture-only-password';
  server = spawn(bin!, [], {stdio: ['ignore', 'pipe', 'pipe'], env: {PATH: process.env.PATH, PGRST_DB_URI: dbUrl.toString(), PGRST_DB_SCHEMAS: 'public', PGRST_DB_ANON_ROLE: 'anon',
    PGRST_JWT_SECRET: JWT_SECRET, PGRST_SERVER_HOST: '127.0.0.1', PGRST_SERVER_PORT: String(PORT), PGRST_DB_CHANNEL_ENABLED: 'false', PGRST_LOG_LEVEL: 'error'}});
  let log = '';
  server.stderr!.on('data', d => { log += String(d); });
  server.stdout!.on('data', d => { log += String(d); });
  realFetch = globalThis.fetch;
  for (let i = 0; ; i++) {
    const ok = await realFetch(`http://127.0.0.1:${PORT}/`).then(r => r.ok, () => false);
    if (ok) break;
    if (i > 100) throw new Error(`PostgREST did not start: ${log}`);
    await new Promise(r => setTimeout(r, 150));
  }
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== SUPABASE) return realFetch(input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (url.pathname === '/auth/v1/user') {
      const claims = verify(headers.get('authorization'));
      return claims?.role === 'authenticated' && claims.sub ? Response.json({id: claims.sub, aud: 'authenticated', role: 'authenticated', is_anonymous: false})
        : Response.json({code: 401, msg: 'invalid JWT'}, {status: 401});
    }
    if (url.pathname.startsWith('/rest/v1/')) return realFetch(`http://127.0.0.1:${PORT}${url.pathname.slice('/rest/v1'.length)}${url.search}`, {...init, headers});
    return new Response('{}', {status: 404});
  }) as typeof fetch;
  setEnv({NEXT_PUBLIC_SUPABASE_URL: SUPABASE, NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt({role: 'anon'}), STRIPE_RESTRICTED_KEY: undefined, CRON_SECRET: undefined, REVENUE_WORKER_TOKEN: undefined,
    STRIPE_WEBHOOK_SECRET: undefined, REVENUE_STRIPE_INTEGRATION_ID: undefined, REVENUE_STRIPE_INTEGRATION_TOKEN: undefined});
});

after(async () => {
  if (realFetch) globalThis.fetch = realFetch;
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  server?.kill();
  await pool?.end();
});

test('authentication: missing, malformed, API-key and forged tokens are refused before any data access', {skip}, async () => {
  failsWith(await get('workspaces', null), 401, /Sign in/);
  failsWith(await get('overview', 'not-a-jwt', {w: W}), 401);
  failsWith(await get('overview', 'veltra_sk_live_123', {w: W}), 401);
  failsWith(await get('overview', jwt({sub: M, role: 'authenticated'}, 'some-other-secret'), {w: W}), 401, /Sign in again/);
  failsWith(await get('overview', jwt({role: 'anon'}), {w: W}), 401, /Sign in again/);
  failsWith(await post('rpc/revenue_upsert_customer', null, {workspace_id: W, args: {p_customer: {email: 'x@y.test'}}}), 401);
  setEnv({NEXT_PUBLIC_SUPABASE_URL: undefined});
  try {
    failsWith(await get('workspaces', as(M)), 503, /not configured/);
  } finally {
    setEnv({NEXT_PUBLIC_SUPABASE_URL: SUPABASE});
  }
});

test('workspace isolation: callers only see and act on workspaces they belong to; others look like "not found"', {skip}, async () => {
  const mine = await get('workspaces', as(M));
  assert.equal(mine.status, 200);
  assert.deepEqual(mine.body.workspaces.map((w: any) => [w.id, w.role]), [[W, 'member']]);
  const theirs = await get('workspaces', as(X));
  assert.deepEqual(theirs.body.workspaces.map((w: any) => w.id), [W2]);

  failsWith(await get('overview', as(X), {w: W}), 404);
  failsWith(await get('customer', as(X), {w: W, id: customer}), 404);
  failsWith(await get('pipeline', as(X), {w: W}), 404);
  failsWith(await get('customer', as(M), {w: W, id: otherCustomer}), 404, /not found/i);
  const list = await get('customers', as(X), {w: W});
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.customers, [], 'row-level security returns nothing, not an error');
  const mail = await get('mail', as(X), {w: W});
  assert.deepEqual([mail.body.messages, mail.body.threads, mail.body.sync], [[], [], []]);
  failsWith(await post('rpc/revenue_upsert_customer', as(X), {workspace_id: W, args: {p_customer: {email: 'intruder@x.test'}}}), 404);
  failsWith(await post('rpc/revenue_create_deal', as(X), {workspace_id: W2, args: {p_customer: customer, p_title: 'Steal', p_value_cents: 1, p_currency: 'USD'}}), 404, /Customer not found/);
  failsWith(await post('draft-reply', as(X), {workspace_id: W, customer, account: A, thread: 't1'}), 404);
  assert.equal((await pool.query('select count(*)::int n from public.crm_customers where workspace_id=$1', [W])).rows[0].n, 1, 'nothing was written');

  const own = await get('customer', as(M), {w: W, id: customer});
  assert.equal(own.status, 200);
  assert.equal(own.body.context.customer.email, 'lee@routes.test');
  assert.equal(own.headers.get('cache-control'), 'no-store');
});

test('roles: viewers read, members write, owners alone manage integrations; tokens are shown once and never readable', {skip}, async () => {
  assert.equal((await get('overview', as(V), {w: W})).status, 200);
  failsWith(await post('rpc/revenue_draft_message', as(V), {workspace_id: W, args: {p_draft: {to: 'lee@routes.test', subject: 'x', body: 'y'}}}), 403, /role/);
  const draft = await post('rpc/revenue_draft_message', as(M), {workspace_id: W, args: {p_draft: {customer_id: customer, to: 'lee@routes.test', subject: 'Hello', body: 'Hi Lee'}}});
  assert.equal(draft.status, 200, JSON.stringify(draft.body));
  assert.equal(draft.body.status, 'drafted');
  failsWith(await post('integrations', as(M), {workspace_id: W, provider: 'calendar', label: 'Booking page'}), 403);
  failsWith(await post('rpc/revenue_set_controls', as(M), {workspace_id: W, args: {p_paused: true}}), 403);
  const created = await post('integrations', as(O), {workspace_id: W, provider: 'calendar', label: 'Booking page'});
  assert.equal(created.status, 200);
  assert.match(created.body.token, /^[a-f0-9]{64}$/);
  const listed = await get('integrations', as(O), {w: W});
  assert.deepEqual(listed.body.integrations.map((i: any) => i.provider), ['calendar']);
  assert.ok(!JSON.stringify(listed.body).includes(created.body.token) && !('token_hash' in listed.body.integrations[0]));
  assert.deepEqual((await get('integrations', as(M), {w: W})).body.integrations, [], 'integrations are visible to owners only');

  const booking = (token: string | null, integration = created.body.integration_id) => calendarPOST(new Request(`https://web.test/api/revenue/calendar/${integration}`, {method: 'POST',
    headers: {'Content-Type': 'application/json', ...(token ? {Authorization: `Bearer ${token}`} : {})},
    body: JSON.stringify({provider: 'booking_form', provider_event_id: 'bk-1', title: 'Intro', starts_at: new Date(Date.now() + 86_400_000).toISOString(),
      ends_at: new Date(Date.now() + 88_200_000).toISOString(), updated_at: new Date().toISOString(), attendees: [{email: 'lee@routes.test'}]})}), {params: Promise.resolve({integration})}).then(read);
  const ok = await booking(created.body.token);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.results[0].customer_id, customer);
  failsWith(await booking(null), 401);
  failsWith(await booking(randomBytes(32).toString('hex')), 401);
  failsWith(await booking(created.body.token, 'not-a-uuid'), 404);
  const cal = await get('integrations', as(M), {w: W});
  assert.ok(Array.isArray(cal.body.calendars));
});

test('validation: workspace, ids, unknown views and actions, smuggled arguments, bad JSON and oversized bodies', {skip}, async () => {
  failsWith(await get('overview', as(M)), 400, /Choose a workspace/);
  failsWith(await get('overview', as(M), {w: 'not-a-uuid'}), 400, /Choose a workspace/);
  failsWith(await get('customer', as(M), {w: W, id: '1 or 1=1'}), 400, /Choose a customer/);
  failsWith(await get('proposal', as(M), {w: W, id: 'x'}), 400, /Choose a proposal/);
  failsWith(await get('thread', as(M), {w: W, account: 'x', thread: 't'}), 400, /Choose a conversation/);
  failsWith(await get('secrets', as(M), {w: W}), 404);
  failsWith(await post('rpc/revenue_upsert_customer', as(M), '{not json'), 400, /Invalid JSON/);
  failsWith(await post('rpc/revenue_upsert_customer', as(M), '[1,2]'), 400, /Invalid JSON/);
  failsWith(await post('rpc/revenue_upsert_customer', as(M), {args: {}}), 400, /Choose a workspace/);
  failsWith(await post('rpc/revenue_worker_claim', as(M), {workspace_id: W, args: {}}), 404, /Unknown action/);
  failsWith(await post('rpc/revenue_ingest_payment_event', as(M), {workspace_id: W, args: {}}), 404, /Unknown action/);
  failsWith(await post('rpc/revenue_upsert_customer', as(M), {workspace_id: W, args: {p_workspace: W2, p_customer: {email: 'x@y.test'}}}), 400, /Unexpected fields: p_workspace/);
  failsWith(await post('rpc/revenue_draft_message', as(M), {workspace_id: W, args: {p_draft: {to: 'not an email', subject: 'x', body: 'y'}}}), 400, /valid recipient/);
  failsWith(await post('rpc/revenue_upsert_customer', as(M), {workspace_id: W, args: {p_customer: {email: 'x@y.test'}}, pad: 'x'.repeat(210_000)}), 413);
  failsWith(await post('integrations', as(O), {workspace_id: W, provider: 'paypal', label: 'x'}), 400, /provider/);
  failsWith(await post('checkout', as(M), {workspace_id: W, proposal_id: randomUUID()}), 503, /Stripe is not configured/);
  failsWith(await post('nothing-here', as(M), {workspace_id: W}), 404);
});

test('provider callbacks and cron: forms, Stripe and the worker refuse missing configuration and bad credentials', {skip}, async () => {
  const form = (integration: string, token: string | null) => formPOST(new Request(`https://web.test/api/revenue/forms/${integration}`, {method: 'POST',
    headers: {'Content-Type': 'application/json', ...(token ? {'X-Onixus-Form-Token': token} : {})}, body: JSON.stringify({submission_id: 's-1', email: 'new@routes.test'})}), {params: Promise.resolve({integration})}).then(read);
  assert.equal((await form('nope', 'x')).status, 404);
  assert.equal((await form(randomUUID(), null)).status, 401);
  assert.equal((await form(randomUUID(), randomBytes(32).toString('hex'))).status, 401);

  const stripe = (sig: string | null) => stripePOST(new Request('https://web.test/api/revenue/webhooks/stripe', {method: 'POST', headers: sig ? {'stripe-signature': sig} : {}, body: '{}'})).then(read);
  assert.equal((await stripe('t=1,v1=00')).status, 503, 'no webhook secret configured');
  setEnv({STRIPE_WEBHOOK_SECRET: `whsec_${randomBytes(16).toString('hex')}`, REVENUE_STRIPE_INTEGRATION_ID: randomUUID(), REVENUE_STRIPE_INTEGRATION_TOKEN: randomBytes(32).toString('hex')});
  const bad = await stripe('t=1,v1=00');
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'Invalid signature.');

  const cron = (auth: string | null) => workerGET(new Request('https://web.test/api/revenue/worker', {headers: auth ? {Authorization: `Bearer ${auth}`} : {}})).then(read);
  failsWith(await cron(null), 401);
  const secret = randomBytes(32).toString('hex');
  setEnv({CRON_SECRET: secret});
  failsWith(await cron(randomBytes(32).toString('hex')), 401);
  assert.equal((await cron(secret)).status, 503, 'no worker token configured');
  const workerToken = randomBytes(32).toString('hex');
  await pool.query(`insert into revenue_private.worker_tokens(token_hash,label) values ($1,'routes') on conflict do nothing`, [sha(workerToken)]);
  setEnv({REVENUE_WORKER_TOKEN: workerToken});
  const ran = await cron(secret);
  assert.equal(ran.status, 200, JSON.stringify(ran.body));
  assert.equal(ran.body.sent, 0, 'the web cron never sends mail');
  setEnv({REVENUE_WORKER_TOKEN: randomBytes(32).toString('hex')});
  failsWith(await cron(secret), 401, /Worker is not authorized/);
});
