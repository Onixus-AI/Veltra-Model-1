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

export function workerDeps(store: RevenueStore, token: string, workerId: string, providerFor: ((accountId: string | null, workspaceId: string) => Promise<MailProvider | null>) | null): WorkerDeps {
  return {
    workerId,
    claim: limit => store.rpc<{jobs: ClaimedJob[]; processed: unknown[]}>('revenue_worker_claim', {p_token: token, p_worker: workerId, p_limit: limit, p_send: Boolean(providerFor)}),
    complete: (jobId, result) => store.rpc('revenue_worker_complete', {p_token: token, p_job: jobId, p_worker: workerId, p_result: result}),
    providerFor: providerFor ?? (async () => null),
  };
}

export function requireBearer(request: Request, expected: string | undefined): void {
  const given = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!expected || expected.length < 32 || given.length !== expected.length) throw new RevenueError(401, 'Not authorized.');
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff) throw new RevenueError(401, 'Not authorized.');
}

const isoTime = (v: unknown) => (typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
const emailLike = (v: unknown) => (typeof v === 'string' && v.length <= 320 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v.trim()) ? v.trim().toLowerCase() : null);

/** Validates one calendar event from an external caller into the shape revenue_ingest_calendar_event accepts. */
export function normalizeCalendarEvent(raw: unknown): {ok: true; event: Record<string, unknown>} | {ok: false; error: string} {
  const e = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const id = text(e.provider_event_id, 1024);
  if (!id) return {ok: false, error: 'provider_event_id is required.'};
  const status = e.status === 'cancelled' ? 'cancelled' : e.status === undefined || e.status === 'confirmed' || e.status === 'tentative' || e.status === 'scheduled' ? 'confirmed' : null;
  if (!status) return {ok: false, error: 'status must be confirmed, tentative or cancelled.'};
  const updated = isoTime(e.updated_at);
  if (!updated) return {ok: false, error: 'updated_at (ISO 8601) is required so duplicates and out-of-order updates can be ignored.'};
  const starts = e.starts_at === undefined || e.starts_at === null ? null : isoTime(e.starts_at), ends = e.ends_at === undefined || e.ends_at === null ? null : isoTime(e.ends_at);
  if ((e.starts_at != null && !starts) || (e.ends_at != null && !ends)) return {ok: false, error: 'starts_at and ends_at must be ISO 8601 times.'};
  if (status !== 'cancelled' && (!starts || !ends || Date.parse(ends) <= Date.parse(starts))) return {ok: false, error: 'A booked meeting needs starts_at before ends_at.'};
  const provider = e.provider === undefined ? 'booking_form' : e.provider;
  if (provider !== 'google_calendar' && provider !== 'microsoft_calendar' && provider !== 'booking_form') return {ok: false, error: 'provider must be google_calendar, microsoft_calendar or booking_form.'};
  const list = Array.isArray(e.attendees) ? e.attendees : [];
  if (list.length > 100) return {ok: false, error: 'At most 100 attendees.'};
  const attendees = list.map(a => (a && typeof a === 'object' ? a as Record<string, unknown> : {})).map(a => ({email: emailLike(a.email), name: text(a.name, 160) || null, self: a.self === true, resource: a.resource === true}))
    .filter(a => a.email);
  return {ok: true, event: {provider_event_id: id, provider, status, title: text(e.title, 300) || null, starts_at: starts, ends_at: ends, updated_at: updated,
    organizer_email: emailLike(e.organizer_email), attendees}};
}

/** Calendar or booking tool callback: up to 100 events per call, each processed independently and idempotently. */
export async function handleCalendarEvents(o: {integrationId: string; token: string | null; payload: unknown; store: RevenueStore}): Promise<HandlerResult> {
  if (!o.token) return {status: 401, body: {error: 'Integration token required.'}};
  const p = (o.payload ?? {}) as Record<string, unknown>;
  const events = Array.isArray(p.events) ? p.events : [p];
  if (!events.length || events.length > 100) return {status: 400, body: {error: 'Send between 1 and 100 events.'}};
  const results: Record<string, unknown>[] = [];
  for (const raw of events) {
    const n = normalizeCalendarEvent(raw);
    if (!n.ok) { results.push({provider_event_id: (raw as {provider_event_id?: unknown})?.provider_event_id ?? null, error: n.error}); continue; }
    try {
      results.push({provider_event_id: n.event.provider_event_id, ...await o.store.rpc<Record<string, unknown>>('revenue_ingest_calendar_event', {p_integration: o.integrationId, p_token: o.token, p_event: n.event})});
    } catch (e) {
      const r = toRevenueError(e);
      if (r.status !== 400 && r.status !== 409) return {status: r.status, body: {error: r.message}};
      results.push({provider_event_id: n.event.provider_event_id, error: r.message});
    }
  }
  const failed = results.filter(r => 'error' in r).length;
  return {status: failed === results.length ? 400 : 200, body: {received: results.length - failed, rejected: failed, results}};
}
