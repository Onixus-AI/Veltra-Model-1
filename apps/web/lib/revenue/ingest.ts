import type {MailIngest} from './mail-sync';
import type {ClaimedJob, WorkerDeps} from './worker';
import type {MailProvider} from './mail-provider';
import {normalizeStripeEvent, verifyStripeSignature, type StripeEvent} from './stripe';
import {RevenueError, toRevenueError, type RevenueStore} from './store';

// Framework-free handlers shared by the Next.js routes and the hermetic harness, so tests
// exercise exactly the code that production requests run.

export type HandlerResult = {status: number; body: Record<string, unknown>};

const fail = (e: unknown): HandlerResult => {
  const r = toRevenueError(e);
  return {status: r.status, body: {error: r.message}};
};

export async function handleStripeWebhook(o: {rawBody: string; signature: string | null; secret: string | undefined; integrationId: string | undefined; token: string | undefined; store: RevenueStore; nowSeconds?: number}): Promise<HandlerResult> {
  if (!o.secret || !o.integrationId || !o.token) return {status: 503, body: {error: 'Payments are not configured for this workspace.'}};
  const verified = verifyStripeSignature(o.rawBody, o.signature, o.secret, 300, o.nowSeconds);
  if (!verified.ok) return {status: 400, body: {error: 'Invalid signature.', reason: verified.reason}};
  let event: StripeEvent;
  try {
    event = JSON.parse(o.rawBody) as StripeEvent;
  } catch {
    return {status: 400, body: {error: 'Invalid payload.'}};
  }
  const normalized = normalizeStripeEvent(event);
  // Unhandled types are acknowledged so Stripe stops retrying them; nothing changes.
  if (!normalized) return {status: 200, body: {received: true, ignored: event.type}};
  if (!normalized.workspace_id || !normalized.proposal_id) return {status: 200, body: {received: true, ignored: 'missing_onixus_metadata'}};
  try {
    const result = await o.store.rpc<Record<string, unknown>>('revenue_ingest_payment_event', {p_integration: o.integrationId, p_token: o.token, p_event: normalized});
    return {status: 200, body: {received: true, ...result}};
  } catch (e) {
    const r = toRevenueError(e);
    // A workspace mismatch is permanent; tell Stripe to stop retrying without revealing details.
    if (r.status === 403) return {status: 200, body: {received: true, ignored: 'workspace_mismatch'}};
    return {status: r.status, body: {error: r.message}};
  }
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export async function handleFormSubmission(o: {integrationId: string; token: string | null; payload: unknown; store: RevenueStore}): Promise<HandlerResult> {
  if (!o.token) return {status: 401, body: {error: 'Integration token required.'}};
  const p = (o.payload ?? {}) as Record<string, unknown>;
  if (text(p.website_url_confirm, 10)) return {status: 200, body: {received: true}};
  const payload = {
    submission_id: text(p.submission_id, 200), email: text(p.email, 320), phone: text(p.phone, 80), name: text(p.name, 160), company: text(p.company, 200),
    subject: text(p.subject, 200), message: text(p.message, 4000), source_url: text(p.source_url, 500),
    utm: typeof p.utm === 'object' && p.utm ? Object.fromEntries(Object.entries(p.utm as Record<string, unknown>).slice(0, 8).map(([k, v]) => [k.slice(0, 40), text(v, 200)])) : null,
  };
  if (!payload.submission_id) return {status: 400, body: {error: 'Submission id is required.'}};
  if (!payload.email && !payload.phone) return {status: 400, body: {error: 'An email address or phone number is required.'}};
  try {
    return {status: 200, body: await o.store.rpc('revenue_ingest_form', {p_integration: o.integrationId, p_token: o.token, p_payload: payload})};
  } catch (e) {
    return fail(e);
  }
}

export function mailIngester(store: RevenueStore, accountId: string, token: string): MailIngest {
  return event => store.rpc('revenue_ingest_mail_event', {p_account: accountId, p_token: token, p_event: event});
}

export function workerDeps(store: RevenueStore, token: string, workerId: string, providerFor: (accountId: string | null, workspaceId: string) => Promise<MailProvider | null>): WorkerDeps {
  return {
    workerId,
    claim: limit => store.rpc<{jobs: ClaimedJob[]; processed: unknown[]}>('revenue_worker_claim', {p_token: token, p_worker: workerId, p_limit: limit}),
    complete: (jobId, result) => store.rpc('revenue_worker_complete', {p_token: token, p_job: jobId, p_worker: workerId, p_result: result}),
    providerFor,
  };
}

export function requireBearer(request: Request, expected: string | undefined): void {
  const given = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!expected || expected.length < 32 || given.length !== expected.length) throw new RevenueError(401, 'Not authorized.');
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff) throw new RevenueError(401, 'Not authorized.');
}
