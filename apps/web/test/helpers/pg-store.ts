import {Pool, type PoolClient} from 'pg';
import {RevenueError, toRevenueError, type RevenueStore, type SelectQuery} from '../../lib/revenue/store';

// Hermetic stand-in for Supabase: every call runs in its own transaction as the same Postgres
// role PostgREST would use (authenticated with JWT claims, or anon), so RLS, grants and the
// SECURITY DEFINER role checks are the real ones.

const ident = (s: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`unsafe identifier ${s}`);
  return `"${s}"`;
};
// Unexpected database errors keep their raw text in the harness so failures are diagnosable.
const mapped = (e: unknown) => {
  const r = toRevenueError(e);
  return r.status === 502 ? new RevenueError(502, `${r.message} [${e instanceof Error ? e.message : String(e)}]`) : r;
};
const param = (v: unknown) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v);

export function testPool(url = process.env.REVENUE_TEST_DATABASE_URL) {
  if (!url) throw new Error('REVENUE_TEST_DATABASE_URL is not set');
  if (!/@(127\.0\.0\.1|localhost|postgres)(:\d+)?\//.test(url)) throw new Error('The revenue harness only runs against a local database.');
  return new Pool({connectionString: url, max: 8});
}

async function asRole<T>(pool: Pool, user: string | null, run: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(user ? 'set local role authenticated' : 'set local role anon');
    await c.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)`,
      [user ?? '', JSON.stringify(user ? {sub: user, role: 'authenticated'} : {role: 'anon'})]);
    const out = await run(c);
    await c.query('commit');
    return out;
  } catch (e) {
    await c.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

export function pgStore(pool: Pool, user: string | null): RevenueStore {
  return {
    async rpc<T>(fn: string, args: Record<string, unknown>) {
      const keys = Object.keys(args);
      const sql = `select public.${ident(fn)}(${keys.map((k, i) => `${ident(k)} => $${i + 1}`).join(', ')}) as r`;
      try {
        return await asRole(pool, user, async c => (await c.query(sql, keys.map(k => param(args[k])))).rows[0].r as T);
      } catch (e) {
        throw mapped(e);
      }
    },
    async select<T>(table: string, q: SelectQuery) {
      const where: string[] = [], values: unknown[] = [];
      for (const [k, v] of Object.entries(q.eq ?? {})) {
        if (v === null) where.push(`${ident(k)} is null`);
        else { values.push(v); where.push(`${ident(k)} = $${values.length}`); }
      }
      for (const [k, v] of Object.entries(q.in ?? {})) { values.push(v); where.push(`${ident(k)} = any($${values.length})`); }
      const cols = !q.columns || q.columns === '*' ? '*' : q.columns.split(',').map(s => ident(s.trim())).join(',');
      const sql = `select ${cols} from public.${ident(table)}${where.length ? ` where ${where.join(' and ')}` : ''}${q.order ? ` order by ${ident(q.order.column)} ${q.order.ascending ? 'asc' : 'desc'}` : ''} limit ${Math.min(q.limit ?? 100, 500)}`;
      try {
        return await asRole(pool, user, async c => (await c.query(sql, values)).rows as T[]);
      } catch (e) {
        throw mapped(e);
      }
    },
  };
}
