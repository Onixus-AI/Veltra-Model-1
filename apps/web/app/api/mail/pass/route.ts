import {anonStore} from '@/lib/revenue/server';
import {googleClient, runMailPass} from '@/lib/mail/workspace-mail';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Supabase calls this once a minute per connected mailbox with a single-use job.
export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > 1024) return Response.json({error: 'Invalid job'}, {status: 400});
  let body: {job_id?: unknown; token?: unknown};
  try { body = JSON.parse(raw); } catch { return Response.json({error: 'Invalid job'}, {status: 400}); }
  if (typeof body.job_id !== 'string' || !/^[a-f0-9-]{36}$/i.test(body.job_id) || typeof body.token !== 'string' || body.token.length !== 72)
    return Response.json({error: 'Invalid job'}, {status: 400});
  try {
    const store = anonStore();
    const report = await runMailPass({rpc: (fn, args) => store.rpc(fn, args), client: googleClient(), jobId: body.job_id, token: body.token,
      workerId: `mail-${process.env.VERCEL_REGION ?? 'local'}`});
    return Response.json(report, {headers: {'Cache-Control': 'no-store'}});
  } catch {
    return Response.json({error: 'Pass unavailable'}, {status: 403});
  }
}
