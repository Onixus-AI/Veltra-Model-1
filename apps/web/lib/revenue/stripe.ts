import {createHmac, timingSafeEqual} from 'node:crypto';

// Stripe webhook verification (v1 scheme): HMAC-SHA256 over "<timestamp>.<raw body>" with the
// endpoint secret, constant-time comparison, and a timestamp tolerance against replay.
export function verifyStripeSignature(rawBody: string, header: string | null, secret: string, toleranceSeconds = 300, nowSeconds = Math.floor(Date.now() / 1000)): {ok: true; timestamp: number} | {ok: false; reason: string} {
  if (!secret || !secret.startsWith('whsec_')) return {ok: false, reason: 'webhook_secret_not_configured'};
  if (!header) return {ok: false, reason: 'missing_signature'};
  const parts = header.split(',').map(p => p.trim().split('=') as [string, string]);
  const timestamp = Number(parts.find(([k]) => k === 't')?.[1]);
  const signatures = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!Number.isInteger(timestamp) || !signatures.length) return {ok: false, reason: 'malformed_signature'};
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return {ok: false, reason: 'timestamp_outside_tolerance'};
  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest();
  const match = signatures.some(s => {
    if (!/^[a-f0-9]{64}$/.test(s)) return false;
    const given = Buffer.from(s, 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  return match ? {ok: true, timestamp} : {ok: false, reason: 'signature_mismatch'};
}

/** Test and fixture helper: produces a header Stripe would send for this body. */
export function signStripePayload(rawBody: string, secret: string, timestamp = Math.floor(Date.now() / 1000)): string {
  return `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex')}`;
}

export type StripeEvent = {id: string; type: string; created: number; livemode: boolean; data: {object: Record<string, any>}};

export type PaymentEvent = {
  event_id: string; type: string; created: string; livemode: boolean;
  workspace_id: string | null; proposal_id: string | null; object_id: string | null;
  amount_cents: number; amount_received_cents: number; amount_refunded_cents: number; currency: string | null;
  failure_code: string | null; failure_message: string | null;
};

export const handledStripeEvents = new Set([
  'checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'checkout.session.expired',
  'payment_intent.succeeded', 'payment_intent.payment_failed', 'payment_intent.canceled', 'charge.refunded',
]);

/** Maps the Stripe objects we subscribe to into one payment event keyed by PaymentIntent. */
export function normalizeStripeEvent(event: StripeEvent): PaymentEvent | null {
  if (!handledStripeEvents.has(event.type)) return null;
  const o = event.data.object ?? {};
  const meta = (o.metadata ?? {}) as Record<string, string>;
  const base = {event_id: event.id, type: event.type, created: new Date(event.created * 1000).toISOString(), livemode: Boolean(event.livemode),
    workspace_id: meta.onixus_workspace_id ?? null, proposal_id: meta.onixus_proposal_id ?? null, currency: typeof o.currency === 'string' ? o.currency.toUpperCase() : null,
    failure_code: null as string | null, failure_message: null as string | null};
  if (event.type.startsWith('checkout.session.')) {
    const paid = o.payment_status === 'paid' && event.type !== 'checkout.session.async_payment_failed';
    return {...base, object_id: (typeof o.payment_intent === 'string' ? o.payment_intent : o.payment_intent?.id) ?? o.id ?? null,
      amount_cents: Number(o.amount_total ?? 0), amount_received_cents: paid ? Number(o.amount_total ?? 0) : 0, amount_refunded_cents: 0,
      failure_code: event.type === 'checkout.session.async_payment_failed' ? 'async_payment_failed' : null,
      failure_message: event.type === 'checkout.session.async_payment_failed' ? 'The delayed payment method failed.' : null};
  }
  if (event.type.startsWith('payment_intent.')) {
    const err = o.last_payment_error ?? null;
    return {...base, object_id: o.id ?? null, amount_cents: Number(o.amount ?? 0), amount_received_cents: Number(o.amount_received ?? 0), amount_refunded_cents: 0,
      failure_code: err?.decline_code ?? err?.code ?? (event.type === 'payment_intent.canceled' ? o.cancellation_reason ?? 'canceled' : null),
      failure_message: err?.message ?? null};
  }
  // charge.refunded carries cumulative amount_refunded on the charge.
  return {...base, object_id: (typeof o.payment_intent === 'string' ? o.payment_intent : o.payment_intent?.id) ?? o.id ?? null,
    amount_cents: Number(o.amount ?? 0), amount_received_cents: Number(o.amount_captured ?? o.amount ?? 0), amount_refunded_cents: Number(o.amount_refunded ?? 0)};
}

/** Creates a Stripe Checkout Session for a proposal. Requires a restricted key with Checkout write access. */
export async function createCheckoutSession(o: {secretKey: string; proposal: {id: string; title: string; amount_cents: number; currency: string; workspace_id: string}; customerEmail?: string | null; successUrl: string; cancelUrl: string; idempotencyKey: string; fetcher?: typeof fetch}) {
  if (!/^(rk|sk)_(test|live)_/.test(o.secretKey)) throw new Error('503:Stripe is not configured for this workspace.');
  const body = new URLSearchParams({
    mode: 'payment', success_url: o.successUrl, cancel_url: o.cancelUrl,
    'line_items[0][quantity]': '1', 'line_items[0][price_data][currency]': o.proposal.currency.toLowerCase(),
    'line_items[0][price_data][unit_amount]': String(o.proposal.amount_cents), 'line_items[0][price_data][product_data][name]': o.proposal.title.slice(0, 250),
    'metadata[onixus_workspace_id]': o.proposal.workspace_id, 'metadata[onixus_proposal_id]': o.proposal.id,
    'payment_intent_data[metadata][onixus_workspace_id]': o.proposal.workspace_id, 'payment_intent_data[metadata][onixus_proposal_id]': o.proposal.id,
  });
  if (o.customerEmail) body.set('customer_email', o.customerEmail);
  const response = await (o.fetcher ?? fetch)('https://api.stripe.com/v1/checkout/sessions', {method: 'POST', headers: {Authorization: `Bearer ${o.secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': o.idempotencyKey}, body, signal: AbortSignal.timeout(15000)});
  const data = await response.json() as {id?: string; url?: string; error?: {message?: string}};
  if (!response.ok || !data.id) throw new Error(`409:Stripe could not create the payment link${data.error?.message ? `: ${data.error.message}` : '.'}`);
  return {id: data.id, url: data.url ?? null, livemode: o.secretKey.includes('_live_')};
}
