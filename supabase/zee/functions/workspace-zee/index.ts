// Deployed to the Zee Supabase project (dpcqgnpoznisqkwkkzhx) as `workspace-zee`,
// verify_jwt off: callers present a Workspace session, checked in core.ts.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { isUuid, verifyWorkspaceZee, zeeEndpoint, type Identity, type ZeeDb, SELECTS } from './core.ts';

const WORKSPACE_URL = 'https://cohmkgctiqcedkuisbqh.supabase.co';
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });

const zee: ZeeDb = {
  async events(i: Identity, opts) {
    let q = db.from('events').select(SELECTS.event).order('event_date', { ascending: true }).limit(100);
    if (!i.admin) q = q.or(`user_id.eq.${i.zeeUser},partner_id.eq.${i.zeeUser}`);
    if (opts.id) q = q.eq('id', opts.id);
    if (opts.open) q = q.is('closed_at', null);
    const r = await q;
    if (r.error) throw new Error('Events unavailable');
    return r.data ?? [];
  },
  async rows(table, eventIds, select) {
    if (!eventIds.length || !eventIds.every(isUuid)) return [];
    const r = await db.from(table).select(select).in('event_id', eventIds).limit(500);
    if (r.error) throw new Error('Event details unavailable');
    return (r.data ?? []) as unknown as Record<string, unknown>[];
  },
};

Deno.serve((request) => zeeEndpoint(request, {
  db: zee,
  identify: (r) => verifyWorkspaceZee(r, {
    workspaceUrl: WORKSPACE_URL,
    fetcher: fetch,
    zeeIdentity: async (email) => {
      const r = await db.rpc('workspace_zee_identity', { p_email: email });
      if (r.error) throw new Error('Zee identity unavailable');
      return Array.isArray(r.data) && r.data[0] ? r.data[0] : null;
    },
  }),
}));
