import {handleStripeWebhook} from '@/lib/revenue/ingest';
import {anonStore, noStore} from '@/lib/revenue/server';
import {revenueResponse} from '@/lib/revenue/store';

export const runtime = 'nodejs';

// Stripe → signature verified on the raw body → normalized event → revenue_ingest_payment_event
// (integration token checked in the database). Browser redirects never reach this path.
export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    if (rawBody.length > 512_000) return Response.json({error: 'Payload too large.'}, {status: 413});
    const result = await handleStripeWebhook({rawBody, signature: request.headers.get('stripe-signature'), secret: process.env.STRIPE_WEBHOOK_SECRET,
      integrationId: process.env.REVENUE_STRIPE_INTEGRATION_ID, token: process.env.REVENUE_STRIPE_INTEGRATION_TOKEN, store: anonStore()});
    return Response.json(result.body, {status: result.status, headers: noStore});
  } catch (e) {
    return revenueResponse(e);
  }
}
