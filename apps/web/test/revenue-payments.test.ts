import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeStripeEvent, signStripePayload, verifyStripeSignature, createCheckoutSession} from '../lib/revenue/stripe';
import {handleStripeWebhook, handleFormSubmission, requireBearer} from '../lib/revenue/ingest';
import {RevenueError, toRevenueError, type RevenueStore} from '../lib/revenue/store';

const SECRET = 'whsec_unit_test_secret_value_000000000000';
const meta = {onixus_workspace_id: 'w1', onixus_proposal_id: 'p1'};

test('Stripe signatures: valid, tampered, wrong secret, stale, malformed and unconfigured', () => {
  const body = JSON.stringify({id: 'evt_1'});
  const now = 1_800_000_000;
  const header = signStripePayload(body, SECRET, now);
  assert.deepEqual(verifyStripeSignature(body, header, SECRET, 300, now), {ok: true, timestamp: now});
  assert.deepEqual(verifyStripeSignature(body + ' ', header, SECRET, 300, now), {ok: false, reason: 'signature_mismatch'});
  assert.deepEqual(verifyStripeSignature(body, signStripePayload(body, 'whsec_other', now), SECRET, 300, now), {ok: false, reason: 'signature_mismatch'});
  assert.deepEqual(verifyStripeSignature(body, header, SECRET, 300, now + 301), {ok: false, reason: 'timestamp_outside_tolerance'});
  assert.deepEqual(verifyStripeSignature(body, 'v1=abc', SECRET, 300, now), {ok: false, reason: 'malformed_signature'});
  assert.deepEqual(verifyStripeSignature(body, null, SECRET, 300, now), {ok: false, reason: 'missing_signature'});
  assert.deepEqual(verifyStripeSignature(body, header, '', 300, now), {ok: false, reason: 'webhook_secret_not_configured'});
  const rotated = `${header},v1=${'0'.repeat(64)}`;
  assert.equal(verifyStripeSignature(body, rotated, SECRET, 300, now).ok, true, 'any matching v1 signature is accepted during secret rotation');
});

test('Stripe events normalize to one payment record per PaymentIntent', () => {
  const checkout = normalizeStripeEvent({id: 'evt_c', type: 'checkout.session.completed', created: 1_800_000_000, livemode: false,
    data: {object: {id: 'cs_1', payment_intent: 'pi_1', payment_status: 'paid', amount_total: 5000, currency: 'eur', metadata: meta}}})!;
  assert.equal(checkout.object_id, 'pi_1');
  assert.equal(checkout.amount_received_cents, 5000);
  assert.equal(checkout.currency, 'EUR');
  assert.equal(checkout.workspace_id, 'w1');
  const unpaid = normalizeStripeEvent({id: 'evt_u', type: 'checkout.session.completed', created: 1, livemode: false, data: {object: {id: 'cs_2', payment_intent: 'pi_2', payment_status: 'unpaid', amount_total: 5000, currency: 'usd', metadata: meta}}})!;
  assert.equal(unpaid.amount_received_cents, 0, 'an async (unpaid) checkout is not a payment');
  const failed = normalizeStripeEvent({id: 'evt_f', type: 'payment_intent.payment_failed', created: 1, livemode: false,
    data: {object: {id: 'pi_1', amount: 5000, amount_received: 0, currency: 'usd', last_payment_error: {decline_code: 'insufficient_funds', message: 'Declined'}, metadata: meta}}})!;
  assert.equal(failed.failure_code, 'insufficient_funds');
  const refund = normalizeStripeEvent({id: 'evt_r', type: 'charge.refunded', created: 1, livemode: true,
    data: {object: {id: 'ch_1', payment_intent: {id: 'pi_1'}, amount: 5000, amount_captured: 5000, amount_refunded: 2000, currency: 'usd', metadata: meta}}})!;
  assert.deepEqual([refund.object_id, refund.amount_refunded_cents, refund.livemode], ['pi_1', 2000, true]);
  assert.equal(normalizeStripeEvent({id: 'evt_x', type: 'invoice.paid', created: 1, livemode: false, data: {object: {}}}), null);
});

test('webhook handler: bad signature never reaches the database; workspace mismatch is acknowledged without changes', async () => {
  const calls: unknown[] = [];
  const store: RevenueStore = {
    async rpc(_fn, args) {
      calls.push(args);
      if ((args.p_event as {workspace_id: string}).workspace_id === 'other') throw new RevenueError(403, 'Payment event belongs to a different workspace.');
      return {duplicate: false, proposal_status: 'paid'} as never;
    },
    async select() { return []; },
  };
  const event = (ws: string) => JSON.stringify({id: 'evt_9', type: 'payment_intent.succeeded', created: Math.floor(Date.now() / 1000), livemode: false,
    data: {object: {id: 'pi_9', amount: 100, amount_received: 100, currency: 'usd', metadata: {onixus_workspace_id: ws, onixus_proposal_id: 'p'}}}});
  const base = {secret: SECRET, integrationId: 'i', token: 't'.repeat(64), store};
  assert.equal((await handleStripeWebhook({...base, rawBody: event('w1'), signature: 't=1,v1=' + 'a'.repeat(64)})).status, 400);
  assert.equal(calls.length, 0);
  const ok = await handleStripeWebhook({...base, rawBody: event('w1'), signature: signStripePayload(event('w1'), SECRET)});
  assert.equal(ok.status, 200);
  assert.equal((calls[0] as {p_event: {object_id: string}}).p_event.object_id, 'pi_9');
  const mismatch = await handleStripeWebhook({...base, rawBody: event('other'), signature: signStripePayload(event('other'), SECRET)});
  assert.deepEqual([mismatch.status, mismatch.body.ignored], [200, 'workspace_mismatch']);
  assert.equal((await handleStripeWebhook({...base, secret: undefined, rawBody: '{}', signature: null})).status, 503);
});

test('form handler validates input, drops honeypot submissions and maps database errors', async () => {
  const seen: Record<string, unknown>[] = [];
  const store: RevenueStore = {async rpc(_f, a) { seen.push(a); return {duplicate: false} as never; }, async select() { return []; }};
  assert.equal((await handleFormSubmission({integrationId: 'i', token: null, payload: {}, store})).status, 401);
  assert.equal((await handleFormSubmission({integrationId: 'i', token: 'x', payload: {email: 'a@b.test'}, store})).status, 400);
  assert.equal((await handleFormSubmission({integrationId: 'i', token: 'x', payload: {submission_id: 's'}, store})).status, 400);
  assert.equal((await handleFormSubmission({integrationId: 'i', token: 'x', payload: {submission_id: 's', email: 'a@b.test', website_url_confirm: 'bot'}, store})).status, 200);
  assert.equal(seen.length, 0, 'honeypot submissions are not stored');
  await handleFormSubmission({integrationId: 'i', token: 'x', payload: {submission_id: 's', email: ' a@b.test ', message: 'x'.repeat(9000), utm: {utm_source: 'g'}}, store});
  const p = seen[0].p_payload as Record<string, string>;
  assert.equal(p.email, 'a@b.test');
  assert.equal(p.message.length, 4000);
});

test('error mapping keeps statuses from the database and hides unexpected detail', () => {
  assert.deepEqual([toRevenueError(new Error('409:Only drafts can be edited.')).status, toRevenueError(new Error('409:Only drafts can be edited.')).message], [409, 'Only drafts can be edited.']);
  assert.equal(toRevenueError({message: 'Mail connection is not authorized', code: '42501'}).status, 403);
  assert.equal(toRevenueError({message: 'relation "public.revenue_events" does not exist', code: '42P01'}).status, 503);
  const hidden = toRevenueError(new Error('duplicate key value violates unique constraint "secret_internal_name"'));
  assert.equal(hidden.status, 502);
  assert.doesNotMatch(hidden.message, /secret_internal_name/);
});

test('bearer check is constant-length and refuses short or missing secrets', () => {
  const secret = 'c'.repeat(40);
  assert.doesNotThrow(() => requireBearer(new Request('https://x.test', {headers: {Authorization: `Bearer ${secret}`}}), secret));
  assert.throws(() => requireBearer(new Request('https://x.test', {headers: {Authorization: 'Bearer nope'}}), secret), /Not authorized/);
  assert.throws(() => requireBearer(new Request('https://x.test'), 'short'), /Not authorized/);
  assert.throws(() => requireBearer(new Request('https://x.test', {headers: {Authorization: `Bearer ${secret}`}}), undefined), /Not authorized/);
});

test('checkout sessions require a Stripe key and send idempotency + metadata', async () => {
  await assert.rejects(createCheckoutSession({secretKey: '', proposal: {id: 'p', title: 't', amount_cents: 100, currency: 'USD', workspace_id: 'w'}, successUrl: 's', cancelUrl: 'c', idempotencyKey: 'k'}), /503:/);
  let body: URLSearchParams | null = null;
  const r = await createCheckoutSession({secretKey: 'rk_test_x', proposal: {id: 'p', title: 't', amount_cents: 100, currency: 'USD', workspace_id: 'w'}, successUrl: 's', cancelUrl: 'c', idempotencyKey: 'k',
    fetcher: (async (_u: RequestInfo | URL, init?: RequestInit) => { body = new URLSearchParams(String(init?.body)); return Response.json({id: 'cs_1', url: 'u'}); }) as typeof fetch});
  assert.equal(r.livemode, false);
  assert.equal(body!.get('metadata[onixus_workspace_id]'), 'w');
  assert.equal(body!.get('line_items[0][price_data][currency]'), 'usd');
});
