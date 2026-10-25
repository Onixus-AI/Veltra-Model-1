// Runs a real PostgREST (the server Supabase uses) against the local revenue database so route
// handlers can call supabase-js unmodified. Only Supabase Auth's /auth/v1/user is replaced, by a
// local HS256 check of the same JWTs PostgREST verifies. Other origins can be faked with `route`.
import {spawn, type ChildProcess} from 'node:child_process';
import {createHmac, randomBytes} from 'node:crypto';
import type {Pool} from 'pg';

export const SUPABASE = 'https://supabase.test';
export const postgrestSkip = (!process.env.REVENUE_TEST_DATABASE_URL || !process.env.REVENUE_TEST_POSTGREST_BIN)
  && 'REVENUE_TEST_DATABASE_URL and REVENUE_TEST_POSTGREST_BIN are required (see docs/revenue-system/setup-and-recovery.md)';

type Handler = (url: URL, init: RequestInit | undefined, headers: Headers) => Response | Promise<Response>;
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');

export function postgrestHarness() {
  const secret = randomBytes(24).toString('hex');
  const port = 3400 + Math.floor(Math.random() * 400);
  const routes = new Map<string, Handler>();
  const saved: Record<string, string | undefined> = {};
  let server: ChildProcess | undefined, realFetch: typeof fetch | undefined;

  const jwt = (claims: Record<string, unknown>, key = secret) => {
    const body = `${b64({alg: 'HS256', typ: 'JWT'})}.${b64({exp: Math.floor(Date.now() / 1000) + 3600, ...claims})}`;
    return `${body}.${createHmac('sha256', key).update(body).digest('base64url')}`;
  };
  const verify = (authorization: string | null) => {
    const [h, p, sig] = (authorization ?? '').replace(/^Bearer /, '').split('.');
    if (!h || !p || createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url') !== sig) return null;
    return JSON.parse(Buffer.from(p, 'base64url').toString()) as {sub?: string; role?: string};
  };
  const setEnv = (values: Record<string, string | undefined>) => {
    for (const [k, v] of Object.entries(values)) { if (!(k in saved)) saved[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  };

  return {
    jwt,
    as: (user: string) => jwt({sub: user, role: 'authenticated', aud: 'authenticated'}),
    setEnv,
    /** Serve another origin (a model gateway, Onixus Mail) from the test instead of the network. */
    route: (origin: string, handler: Handler) => { routes.set(origin, handler); },
    async start(pool: Pool) {
      await pool.query(`do $$ begin if not exists(select 1 from pg_roles where rolname='authenticator') then create role authenticator login password 'fixture-only-password' noinherit; end if; end $$`);
      await pool.query('grant anon, authenticated to authenticator');
      const dbUrl = new URL(process.env.REVENUE_TEST_DATABASE_URL!);
      dbUrl.username = 'authenticator'; dbUrl.password = 'fixture-only-password';
      server = spawn(process.env.REVENUE_TEST_POSTGREST_BIN!, [], {stdio: ['ignore', 'pipe', 'pipe'], env: {NODE_ENV: 'test', PATH: process.env.PATH, PGRST_DB_URI: dbUrl.toString(),
        PGRST_DB_SCHEMAS: 'public', PGRST_DB_ANON_ROLE: 'anon', PGRST_JWT_SECRET: secret, PGRST_SERVER_HOST: '127.0.0.1', PGRST_SERVER_PORT: String(port),
        PGRST_DB_CHANNEL_ENABLED: 'false', PGRST_LOG_LEVEL: 'error'}});
      let log = '';
      server.stderr!.on('data', d => { log += String(d); });
      server.stdout!.on('data', d => { log += String(d); });
      const original = globalThis.fetch;
      realFetch = original;
      for (let i = 0; ; i++) {
        if (await original(`http://127.0.0.1:${port}/`).then(r => r.ok, () => false)) break;
        if (i > 100) throw new Error(`PostgREST did not start: ${log}`);
        await new Promise(r => setTimeout(r, 150));
      }
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
        if (url.origin === SUPABASE) {
          if (url.pathname === '/auth/v1/user') {
            const claims = verify(headers.get('authorization'));
            return claims?.role === 'authenticated' && claims.sub ? Response.json({id: claims.sub, aud: 'authenticated', role: 'authenticated', is_anonymous: false})
              : Response.json({code: 401, msg: 'invalid JWT'}, {status: 401});
          }
          if (url.pathname.startsWith('/rest/v1/')) return original(`http://127.0.0.1:${port}${url.pathname.slice('/rest/v1'.length)}${url.search}`, {...init, headers});
          return new Response('{}', {status: 404});
        }
        const handler = routes.get(url.origin);
        if (handler) return handler(url, init, headers);
        if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return original(input, init);
        throw new Error(`Unexpected network call to ${url.origin}`);
      }) as typeof fetch;
      setEnv({NEXT_PUBLIC_SUPABASE_URL: SUPABASE, NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt({role: 'anon'})});
    },
    async stop() {
      if (realFetch) globalThis.fetch = realFetch;
      for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      server?.kill();
    },
  };
}
