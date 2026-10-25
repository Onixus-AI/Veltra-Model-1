import {requireBearer, workerDeps} from '@/lib/revenue/ingest';
import {anonStore, noStore} from '@/lib/revenue/server';
import {revenueResponse} from '@/lib/revenue/store';
import {runWorker} from '@/lib/revenue/worker';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Scheduled worker pass (Vercel cron sends `Authorization: Bearer $CRON_SECRET`). Gmail tokens live
// in the Onixus Mail service, so this worker runs internal jobs (acknowledgement and follow-up
// drafts, onboarding checklists) and leaves mail.send jobs queued for the Onixus Mail relay, which
// claims them with each mailbox's own CRM token (revenue_mail_claim).
async function run(request: Request) {
  try {
    requireBearer(request, process.env.CRON_SECRET);
    const token = process.env.REVENUE_WORKER_TOKEN;
    if (!token) return Response.json({error: 'The revenue worker is not configured.'}, {status: 503, headers: noStore});
    const report = await runWorker(workerDeps(anonStore(), token, `web-${process.env.VERCEL_REGION ?? 'local'}`, null), 25);
    return Response.json(report, {headers: noStore});
  } catch (e) {
    return revenueResponse(e);
  }
}

export const GET = run;
export const POST = run;
