// Trucking quotes, written by code (the model never states a price). Ported from Onixus Mail's
// quoting engine (veltra-mail src/quoting.ts + agent/graph.ts, retired 2026-11): in trucking you
// always answer a rate request with a rate, plus the standard disclaimers.
//  1. A saved lane rate from the company's TMS, when there is one.
//  2. Otherwise the owner's rate card: driving miles × rate per mile, fuel %, accessorials asked
//     for, never under the minimum.
//  3. When the distance can't be measured: the rate card itself, as unit rates.

export type Accessorial = {name: string; price: number; per: 'flat' | 'stop' | 'hour'};
export type RateCard = {per_mile: number; minimum: number; fuel_pct: number; accessorials: Accessorial[]};
export type Lane = {origin: string; destination: string; equipment_type?: string; container_size?: string | null; accessorials?: string[] | null; extra_stops?: number | null};
export type Distance = (from: string, to: string) => Promise<number | null>;
export type QuoteLine = {label: string; amount: number};

export const DEFAULT_VALID_DAYS = 3;
const usd = (n: number) => `$${n.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
const cents = (n: number) => Math.round(n * 100) / 100;

export function validRateCard(c: unknown): c is RateCard {
  const r = c as RateCard;
  return !!r && typeof r === 'object' && Number.isFinite(r.per_mile) && r.per_mile > 0 && r.per_mile <= 100
    && Number.isFinite(r.minimum) && r.minimum >= 0 && Number.isFinite(r.fuel_pct) && r.fuel_pct >= 0 && r.fuel_pct <= 100
    && Array.isArray(r.accessorials) && r.accessorials.length <= 30
    && r.accessorials.every(a => a && typeof a.name === 'string' && a.name.trim() && Number.isFinite(a.price) && a.price >= 0 && ['flat', 'stop', 'hour'].includes(a.per));
}

/** One load priced from the rate card: linehaul, fuel, each accessorial asked for, never under the minimum. */
export function mileageQuote(m: RateCard, miles: number, extras: {accessorials: string[]; stops: number}) {
  const linehaul = cents(miles * m.per_mile);
  const lines: QuoteLine[] = [{label: `Linehaul: ${Math.round(miles)} mi × ${usd(m.per_mile)}/mi`, amount: linehaul}];
  if (m.fuel_pct) lines.push({label: `Fuel surcharge (${m.fuel_pct}%)`, amount: cents((linehaul * m.fuel_pct) / 100)});
  const unpriced: string[] = [];
  const asked = new Set(extras.accessorials.map(a => a.trim().toLowerCase()).filter(Boolean));
  for (const a of m.accessorials) {
    if (a.per === 'stop') {
      if (extras.stops > 0) lines.push({label: `${a.name} × ${extras.stops}`, amount: cents(a.price * extras.stops)});
      asked.delete(a.name.toLowerCase());
      continue;
    }
    if (!asked.has(a.name.toLowerCase())) continue;
    asked.delete(a.name.toLowerCase());
    // Hours (detention, waiting) aren't known until the load moves: quoted as a rate.
    if (a.per === 'hour') unpriced.push(`${a.name} at ${usd(a.price)}/hour if needed`);
    else lines.push({label: a.name, amount: a.price});
  }
  unpriced.push(...[...asked].map(x => `${x}: priced on confirmation`));
  let total = cents(lines.reduce((s, l) => s + l.amount, 0));
  if (total < m.minimum) { lines.push({label: 'Minimum charge adjustment', amount: cents(m.minimum - total)}); total = cents(m.minimum); }
  return {miles: Math.round(miles), lines, total, unpriced};
}

/** Driving distance from Google Maps (Routes API); null when it can't be measured. */
export function googleDistance(apiKey: string, o: {fetcher?: typeof fetch; url?: string} = {}): Distance {
  const cache = new Map<string, number | null>();
  return async (from, to) => {
    const key = `${from.trim().toLowerCase()}→${to.trim().toLowerCase()}`;
    if (cache.has(key)) return cache.get(key)!;
    const r = await (o.fetcher ?? fetch)(o.url ?? 'https://routes.googleapis.com/directions/v2:computeRoutes', {method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: {'content-type': 'application/json', 'x-goog-api-key': apiKey, 'x-goog-fieldmask': 'routes.distanceMeters'},
      body: JSON.stringify({origin: {address: from}, destination: {address: to}, travelMode: 'DRIVE', units: 'IMPERIAL'})});
    // Say why Maps refused (key missing a permission, billing off, API not enabled): the quote records it.
    if (!r.ok) throw new Error(`Google Maps ${r.status}: ${((await r.json().catch(() => ({}))) as {error?: {message?: string}}).error?.message?.slice(0, 160) ?? 'no detail'}`);
    const meters = ((await r.json().catch(() => ({}))) as {routes?: {distanceMeters?: number}[]}).routes?.[0]?.distanceMeters;
    const miles = meters ? meters / 1609.344 : null;
    if (cache.size > 2000) cache.clear();
    cache.set(key, miles);
    return miles;
  };
}

const TERMS_TOTAL = (days: number) => `This quote is valid for ${days} days from the date of this email.
Based on the shipment details provided and our configured rates. Final charges may change if the lane, equipment, commodity, weight, quantities, service dates or handling requirements differ. Additional services and accessorials are charged at our applicable rates; any revised quote will be confirmed before booking.`;
const TERMS_UNIT = (days: number) => `This quote is valid for ${days} days from the date of this email. These are unit rates, not a confirmed all-in shipment total. Final charges depend on the actual lane, equipment, weight, commodity, quantities, storage duration and requested services. Additional accessorials are charged at applicable rates. We will confirm any revised quote before booking. Subject to availability; no capacity is reserved.
Assumptions: standard service within the stated rate conditions; quantities and shipment details as provided. Please include any changes when accepting.`;
const AVAILABILITY = 'Subject to equipment and service availability. This quotation does not reserve capacity or confirm a booking.';

export type WrittenQuote = {body: string; method: 'tariff' | 'mileage' | 'unit_rates'; total: number | null; miles: number | null;
  /** Why the quote fell back to unit rates, when it did (Maps not set up, address not found, Maps error). */
  note?: string};

/**
 * The reply to a rate request, every word chosen by code. Returns null only when there is nothing
 * to quote from (no TMS rate and no rate card): then a person prices it.
 */
export async function writeQuote(o: {lane: Lane | null; tms: Record<string, unknown> | null; card: RateCard | null; distance: Distance | null;
  signature: string; validDays?: number; greeting?: string}): Promise<WrittenQuote | null> {
  const days = o.validDays ?? DEFAULT_VALID_DAYS;
  const sign = (body: string) => `${o.greeting ? o.greeting + '\n\n' : ''}${body}\n\n${o.signature}`.trim();
  const lane = o.lane ? `${o.lane.origin} to ${o.lane.destination}` : '';
  if (o.tms && typeof o.tms.total === 'number') {
    const t = o.tms as {total: number; base_rate?: number; fuel_surcharge?: number; miles_estimated?: number; method?: string};
    const lines = [t.base_rate != null ? `Linehaul: ${usd(t.base_rate)}` : '', t.fuel_surcharge ? `Fuel surcharge: ${usd(t.fuel_surcharge)}` : '', `Total: ${usd(t.total)} per load`].filter(Boolean);
    const est = t.method === 'mileage' && t.miles_estimated ? `\nMiles are estimated (${t.miles_estimated} mi).` : '';
    return {method: 'tariff', total: t.total, miles: t.miles_estimated ?? null,
      body: sign(`Our quote${lane ? ` for ${lane}` : ''} (USD):\n${lines.join('\n')}${est}\n\n${TERMS_TOTAL(days)}\n${AVAILABILITY}`)};
  }
  if (!o.card) return null;
  let note = !o.lane ? 'No pickup and delivery found in the email' : !o.distance ? 'Driving miles not set up (GOOGLE_MAPS_API_KEY)' : '';
  const miles = o.lane && o.distance ? await o.distance(o.lane.origin, o.lane.destination).catch((e: unknown) => { note = e instanceof Error ? e.message : 'Google Maps failed'; return null; }) : null;
  if (o.lane && o.distance && miles === null && !note) note = 'Google Maps found no driving route for these addresses';
  if (o.lane && miles) {
    const q = mileageQuote(o.card, miles, {accessorials: o.lane.accessorials ?? [], stops: Math.max(0, Math.min(20, o.lane.extra_stops ?? 0))});
    const breakdown = q.lines.map(l => `${l.label}: ${usd(l.amount)}`).join('\n');
    const cond = q.unpriced.length ? `\nRate conditions: ${q.unpriced.join('; ')}.` : '';
    return {method: 'mileage', total: q.total, miles: q.miles,
      body: sign(`Quote for ${lane} (USD):\n${breakdown}\nTotal: ${usd(q.total)} per load.\n\n${TERMS_TOTAL(days)}${cond}\n${AVAILABILITY}`)};
  }
  const c = o.card;
  const rates = [`Transportation: ${usd(c.per_mile)} per mile${c.fuel_pct ? `, plus ${c.fuel_pct}% fuel surcharge` : ''}${c.minimum ? `; minimum ${usd(c.minimum)} per load` : ''}. Distance and final total subject to lane confirmation.`,
    ...c.accessorials.map(a => `${a.name}: ${usd(a.price)} per ${a.per}.`)];
  return {method: 'unit_rates', total: null, miles: null, note, body: sign(`Our quoted rates (USD)${lane ? ` for ${lane}` : ''}:\n${rates.join('\n')}\n\n${TERMS_UNIT(days)}`)};
}
