import {MailProviderError, messageIdFor, type MailProvider} from './mail-provider';

export type ClaimedJob = {
  job_id: string; kind: string; workspace_id: string; attempt: number;
  message?: {id: string; account_id: string | null; thread_id: string | null; to: string; cc: string | null; subject: string; body: string;
    from_email: string | null; from_name: string | null; reply_to: string | null; in_reply_to: string | null; references?: string | null; idempotency_key: string};
};

export type WorkerDeps = {
  workerId: string;
  claim(limit: number): Promise<{jobs: ClaimedJob[]; processed: unknown[]}>;
  complete(jobId: string, result: Record<string, unknown>): Promise<unknown>;
  providerFor(accountId: string | null, workspaceId: string): Promise<MailProvider | null>;
};

export type WorkerReport = {claimed: number; sent: number; retrying: number; failed: number; internal: number; outcomes: {job_id: string; outcome: string; detail?: string}[]};

/** One worker pass. The database decides eligibility (pause, limits, suppression, reply-stop) at claim time. */
export async function runWorker(deps: WorkerDeps, limit = 10): Promise<WorkerReport> {
  const {jobs, processed} = await deps.claim(limit);
  const report: WorkerReport = {claimed: jobs.length, sent: 0, retrying: 0, failed: 0, internal: processed.length, outcomes: []};
  for (const job of jobs) {
    if (job.kind !== 'mail.send' || !job.message) {
      await deps.complete(job.job_id, {ok: false, retryable: false, error: {code: 'unsupported_job', message: `No handler for ${job.kind}`}});
      report.failed++;
      continue;
    }
    const m = job.message;
    const provider = await deps.providerFor(m.account_id, job.workspace_id).catch(() => null);
    if (!provider) {
      await deps.complete(job.job_id, {ok: false, retryable: false, error: {code: 'provider_unavailable', message: 'No connected mailbox can send for this workspace. Connect Google in Onixus Mail, then retry.'}});
      report.failed++;
      report.outcomes.push({job_id: job.job_id, outcome: 'failed', detail: 'provider_unavailable'});
      continue;
    }
    try {
      const previous = job.attempt > 1 && provider.findSent ? await provider.findSent(m.idempotency_key) : null;
      const sent = previous ?? await provider.send({idempotencyKey: m.idempotency_key, from: m.from_email ?? await provider.address(), fromName: m.from_name, replyTo: m.reply_to,
        to: m.to, cc: m.cc, subject: m.subject, body: m.body, threadId: m.thread_id, inReplyTo: m.in_reply_to, references: m.references});
      const r = await deps.complete(job.job_id, {ok: true, provider: provider.name, provider_message_id: sent.providerMessageId, provider_thread_id: sent.providerThreadId,
        message_id_header: messageIdFor(m.idempotency_key)}) as {status?: string};
      report.sent++;
      report.outcomes.push({job_id: job.job_id, outcome: r?.status ?? 'succeeded'});
    } catch (e) {
      const known = e instanceof MailProviderError;
      const result = await deps.complete(job.job_id, {ok: false, retryable: known ? e.retryable : true, error: {code: known ? e.code : 'temporary', message: known ? e.message : 'Unexpected sending error.'}}) as {status?: string};
      if (result?.status === 'queued') report.retrying++; else report.failed++;
      report.outcomes.push({job_id: job.job_id, outcome: result?.status ?? 'error', detail: known ? e.code : 'temporary'});
    }
  }
  return report;
}
