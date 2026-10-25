import {handleCalendarEvents} from '@/lib/revenue/ingest';
import {anonStore, noStore, readJson, uuid} from '@/lib/revenue/server';
import {revenueResponse} from '@/lib/revenue/store';

export const runtime = 'nodejs';
type Context = {params: Promise<{integration: string}>};

// Booking tools and calendars other than the Google Calendar read by Onixus Mail post meeting
// changes here with their workspace calendar token (Authorization: Bearer). The token can only
// record meetings for its own workspace; it cannot read anything.
export async function POST(request: Request, context: Context) {
  try {
    const {integration} = await context.params;
    if (!uuid(integration)) return Response.json({error: 'Unknown calendar integration.'}, {status: 404, headers: noStore});
    const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || null;
    const result = await handleCalendarEvents({integrationId: integration, token, payload: await readJson(request, 400_000), store: anonStore()});
    return Response.json(result.body, {status: result.status, headers: noStore});
  } catch (e) {
    return revenueResponse(e);
  }
}
