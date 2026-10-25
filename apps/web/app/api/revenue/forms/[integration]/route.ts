import {handleFormSubmission} from '@/lib/revenue/ingest';
import {anonStore, readJson, uuid} from '@/lib/revenue/server';
import {revenueResponse} from '@/lib/revenue/store';

export const runtime = 'nodejs';
type Context = {params: Promise<{integration: string}>};

// Website forms post here with their workspace form token. The token can only create inquiries
// for its own workspace; it cannot read anything.
const cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-Onixus-Form-Token', 'Cache-Control': 'no-store'};

export function OPTIONS() {
  return new Response(null, {status: 204, headers: cors});
}

export async function POST(request: Request, context: Context) {
  try {
    const {integration} = await context.params;
    if (!uuid(integration)) return Response.json({error: 'Unknown form.'}, {status: 404, headers: cors});
    const token = request.headers.get('x-onixus-form-token') ?? request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null;
    const result = await handleFormSubmission({integrationId: integration, token, payload: await readJson(request, 20_000), store: anonStore()});
    const body = result.status === 200 ? {received: true} : result.body;
    return Response.json(body, {status: result.status, headers: cors});
  } catch (e) {
    const r = revenueResponse(e);
    return new Response(r.body, {status: r.status, headers: {...cors, 'Content-Type': 'application/json'}});
  }
}
