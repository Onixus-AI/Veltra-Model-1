import type {SupabaseClient} from '@supabase/supabase-js';
import {toRevenueError} from './errors';

// Every revenue write is a Postgres function that re-checks the caller's workspace role, so the
// same store interface works for a signed-in user (Supabase JWT), an integration token, or the
// hermetic test harness (local Postgres with the same functions).
export interface RevenueStore {
  rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T>;
  select<T = Record<string, unknown>>(table: string, query: SelectQuery): Promise<T[]>;
}

export type SelectQuery = {
  columns?: string;
  eq?: Record<string, string | number | boolean | null>;
  in?: Record<string, (string | number)[]>;
  order?: {column: string; ascending?: boolean};
  limit?: number;
};

export {RevenueError, toRevenueError} from './errors';

export function supabaseStore(client: SupabaseClient): RevenueStore {
  return {
    async rpc<T>(fn: string, args: Record<string, unknown>) {
      const {data, error} = await client.rpc(fn, args);
      if (error) throw toRevenueError(error);
      return data as T;
    },
    async select<T>(table: string, query: SelectQuery) {
      let q = client.from(table).select(query.columns ?? '*');
      for (const [k, v] of Object.entries(query.eq ?? {})) q = v === null ? q.is(k, null) : q.eq(k, v);
      for (const [k, v] of Object.entries(query.in ?? {})) q = q.in(k, v);
      if (query.order) q = q.order(query.order.column, {ascending: query.order.ascending ?? false});
      q = q.limit(Math.min(query.limit ?? 100, 500));
      const {data, error} = await q;
      if (error) throw toRevenueError(error);
      return (data ?? []) as T[];
    },
  };
}

export function revenueResponse(error: unknown) {
  const e = toRevenueError(error);
  return Response.json({error: e.message}, {status: e.status, headers: {'Cache-Control': 'no-store'}});
}
