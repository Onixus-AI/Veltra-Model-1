import {createClient} from '@supabase/supabase-js';
import {crmUser} from '@/lib/crm/server';
import {RevenueError, supabaseStore} from './store';

// Signed-in calls run as the user (RLS + role checks in every RPC). Provider callbacks use the
// public anon key plus a workspace-scoped integration token checked inside the database; the web
// app never holds a service-role key.

export async function revenueUser(request: Request) {
  try {
    const {client, user} = await crmUser(request);
    return {client, user, store: supabaseStore(client)};
  } catch (e) {
    const m = /^(\d{3}):(.*)$/.exec(e instanceof Error ? e.message : '');
    throw m ? new RevenueError(Number(m[1]), m[2]) : e;
  }
}

export function anonStore() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new RevenueError(503, 'Onixus CRM is not configured.');
  return supabaseStore(createClient(url, key, {auth: {persistSession: false, autoRefreshToken: false}}));
}

export const uuid = (s: unknown): s is string => typeof s === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(s);

export async function readJson(request: Request, max = 200_000): Promise<Record<string, unknown>> {
  const raw = await request.text();
  if (raw.length > max) throw new RevenueError(413, 'Request is too large.');
  try {
    const v = JSON.parse(raw || '{}');
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
    return v as Record<string, unknown>;
  } catch {
    throw new RevenueError(400, 'Invalid JSON.');
  }
}

export const noStore = {'Cache-Control': 'no-store'};
