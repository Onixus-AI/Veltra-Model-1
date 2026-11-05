// Trucking quotes, written by code (the model never states a price). Ported from Onixus Mail's
// quoting engine (veltra-mail src/quoting.ts + agent/graph.ts, retired 2026-11): in trucking you
// always answer a rate request with a rate, plus the standard disclaimers.
//  1. A saved lane rate from the company's TMS, when there is one.
//  2. Otherwise the owner's rate card: driving miles × rate per mile, fuel %, accessorials asked
//     for, never under the minimum. Drayage is always round trip (the container goes back) and
//     always carries a chassis; OTR is one way unless the request says round trip. Several
//     destinations are priced one by one.
//  3. When the distance can't be measured: the rate card itself, as unit rates.

export type Accessorial = {name: string; price: number; per: 'flat' | 'stop' | 'hour' | 'day'; /** minimum days, e.g. chassis 3 */ min?: number};
export type RateCard = {per_mile: number; minimum: number; fuel_pct: number; accessorials: Accessorial[]};
export type Lane = {origin: string; destination: string; equipment_type?: string; container_size?: string | null; accessorials?: string[] | null; extra_stops?: number | null;
  /** Every delivery point when the request lists several (each is priced on its own). */
  destinations?: string[] | null; /** The request asks for a round trip (OTR); drayage always is. */ round_trip?: boolean | null};

const PORTISH = /\b(port|terminal|nit|vig|pmt|apm|ramp|rail ?yard|intermodal|cy)\b/i;
/** Container work: priced round trip with a chassis. */
export const isDrayage = (l: Pick<Lane, 'equipment_type' | 'container_size' | 'origin' | 'destination'>) =>
  l.equipment_type === 'CONTAINER' || !!l.container_size || PORTISH.test(`${l.origin} ${l.destination}`);
const perLabel = (a: Accessorial) => a.per === 'day' ? `per day${a.min && a.min > 1 ? ` (${a.min}-day minimum)` : ''}` : `per ${a.per}`;
export type Distance = (from: string, to: string) => Promise<number | null>;
/** Fallback when Maps has no route: estimated miles from ZIP or city (see places.ts). */
export type Estimate = (from: string, to: string) => number | null;
export type QuoteLine = {label: string; amount: number};

export const DEFAULT_VALID_DAYS = 3;
const usd = (n: number) => `$${n.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
const cents = (n: number) => Math.round(n * 100) / 100;

export function validRateCard(c: unknown): c is RateCard {
  const r = c as RateCard;
  return !!r && typeof r === 'object' && Number.isFinite(r.per_mile) && r.per_mile > 0 && r.per_mile <= 100
    && Number.isFinite(r.minimum) && r.minimum >= 0 && Number.isFinite(r.fuel_pct) && r.fuel_pct >= 0 && r.fuel_pct <= 100
    && Array.isArray(r.accessorials) && r.accessorials.length <= 30
    && r.accessorials.every(a => a && typeof a.name === 'string' && a.name.trim() && Number.isFinite(a.price) && a.price >= 0 && ['flat', 'stop', 'hour', 'day'].includes(a.per)
      && (a.min === undefined || (Number.isInteger(a.min) && a.min >= 1 && a.min <= 30)));
}

/** One load priced from the rate card: linehaul, fuel, each accessorial asked for, never under the minimum. */
export function mileageQuote(m: RateCard, miles: number, extras: {accessorials: string[]; stops: number; roundTrip?: boolean; drayage?: boolean}) {
  const legs = extras.roundTrip || extras.drayage ? 2 : 1, billed = miles * legs;
  const linehaul = cents(billed * m.per_mile);
  const label = legs === 2 ? `Linehaul: ${Math.round(miles)} mi each way, round trip ${Math.round(billed)} mi × ${usd(m.per_mile)}/mi` : `Linehaul: ${Math.round(miles)} mi × ${usd(m.per_mile)}/mi`;
  const lines: QuoteLine[] = [{label, amount: linehaul}];
  if (m.fuel_pct) lines.push({label: `Fuel surcharge (${m.fuel_pct}%)`, amount: cents((linehaul * m.fuel_pct) / 100)});
  const unpriced: string[] = [];
  const asked = new Set(extras.accessorials.map(a => a.trim().toLowerCase()).filter(Boolean));
  // Drayage always needs a chassis.
  if (extras.drayage) for (const a of m.accessorials) if (/chassis/i.test(a.name)) asked.add(a.name.toLowerCase());
  for (const a of m.accessorials) {
    if (a.per === 'stop') {
      if (extras.stops > 0) lines.push({label: `${a.name} × ${extras.stops}`, amount: cents(a.price * extras.stops)});
      asked.delete(a.name.toLowerCase());
      continue;
    }
    // Exact name first ("chassis"), else the first that contains it; others ("chassis split") stay as conditions.
    const hit = asked.has(a.name.toLowerCase()) ? a.name.toLowerCase() : [...asked].find(x => x.includes(a.name.toLowerCase()));
    if (!hit) continue;
    asked.delete(hit);
    // Hours (detention, waiting) aren't known until the load moves: quoted as a rate.
    if (a.per === 'hour') unpriced.push(`${a.name} at ${usd(a.price)}/hour if needed`);
    else if (a.per === 'day') { const days = Math.max(1, a.min ?? 1); lines.push({label: `${a.name}: ${days} day${days > 1 ? 's' : ''} minimum × ${usd(a.price)}/day`, amount: cents(a.price * days)}); }
    else lines.push({label: a.name, amount: a.price});
  }
  unpriced.push(...[...asked].map(x => `${x}: priced on confirmation`));
  let total = cents(lines.reduce((s, l) => s + l.amount, 0));
  if (total < m.minimum) { lines.push({label: 'Minimum charge adjustment', amount: cents(m.minimum - total)}); total = cents(m.minimum); }
  return {miles: Math.round(miles), lines, total, unpriced};
}

const lastNoRoute = new Map<string, string>();
/** Why Google found no route for this pair, when it said (for the quote's note). */
export const noRouteReason = (from: string, to: string) => lastNoRoute.get(`${from}→${to}`) ?? lastNoRoute.get(`${from}, USA→${to}, USA`);

/** Driving distance from Google Maps (Routes API); null when it can't be measured. */
export function googleDistance(apiKey: string, o: {fetcher?: typeof fetch; url?: string} = {}): Distance {
  const cache = new Map<string, number | null>();
  return async (from, to) => {
    const key = `${from.trim().toLowerCase()}→${to.trim().toLowerCase()}`;
    if (cache.has(key)) return cache.get(key)!;
    const r = await (o.fetcher ?? fetch)(o.url ?? 'https://routes.googleapis.com/directions/v2:computeRoutes', {method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: {'content-type': 'application/json', 'x-goog-api-key': apiKey, 'x-goog-fieldmask': 'routes.distanceMeters,geocodingResults'},
      body: JSON.stringify({origin: {address: from}, destination: {address: to}, travelMode: 'DRIVE', units: 'IMPERIAL'})});
    // Say why Maps refused (key missing a permission, billing off, API not enabled): the quote records it.
    if (!r.ok) throw new Error(`Google Maps ${r.status}: ${((await r.json().catch(() => ({}))) as {error?: {message?: string}}).error?.message?.slice(0, 160) ?? 'no detail'}`);
    type Geo = {geocoderStatus?: {code?: number; message?: string}};
    const data = (await r.json().catch(() => ({}))) as {routes?: {distanceMeters?: number}[]; geocodingResults?: {origin?: Geo; destination?: Geo}};
    const meters = data.routes?.[0]?.distanceMeters;
    const miles = meters ? meters / 1609.344 : null;
    // No route: say which address Google could not place, when it says so.
    const geo = (g?: Geo) => g?.geocoderStatus?.code ? g.geocoderStatus.message ?? `code ${g.geocoderStatus.code}` : '';
    if (!miles && (geo(data.geocodingResults?.origin) || geo(data.geocodingResults?.destination)))
      lastNoRoute.set(`${from}→${to}`, `Google Maps could not place ${[geo(data.geocodingResults?.origin) && 'the pickup', geo(data.geocodingResults?.destination) && 'the delivery'].filter(Boolean).join(' or ')}`);
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
  estimate?: Estimate | null; signature: string; validDays?: number; greeting?: string}): Promise<WrittenQuote | null> {
  const days = o.validDays ?? DEFAULT_VALID_DAYS;
  const sign = (body: string) => `${o.greeting ? o.greeting + '\n\n' : ''}${body}\n\n${o.signature}`.trim();
  const tmsLane = o.lane ? `${o.lane.origin} to ${o.lane.destination}` : '';
  if (o.tms && typeof o.tms.total === 'number') {
    const t = o.tms as {total: number; base_rate?: number; fuel_surcharge?: number; miles_estimated?: number; method?: string};
    const lines = [t.base_rate != null ? `Linehaul: ${usd(t.base_rate)}` : '', t.fuel_surcharge ? `Fuel surcharge: ${usd(t.fuel_surcharge)}` : '', `Total: ${usd(t.total)} per load`].filter(Boolean);
    const est = t.method === 'mileage' && t.miles_estimated ? `\nMiles are estimated (${t.miles_estimated} mi).` : '';
    return {method: 'tariff', total: t.total, miles: t.miles_estimated ?? null,
      body: sign(`Our quote${tmsLane ? ` for ${tmsLane}` : ''} (USD):\n${lines.join('\n')}${est}\n\n${TERMS_TOTAL(days)}\n${AVAILABILITY}`)};
  }
  if (!o.card) return null;
  const card = o.card, l = o.lane;
  const drayage = !!l && isDrayage(l), roundTrip = drayage || !!l?.round_trip;
  // Several delivery points: each gets its own price.
  const stops = l ? (l.destinations?.filter(d => d.trim()).length ?? 0) > 1 ? l.destinations!.filter(d => d.trim()) : [l.destination] : [];
  let note = !l ? 'No pickup and delivery found in the email' : !o.distance ? 'Driving miles not set up (GOOGLE_MAPS_API_KEY)' : '';
  // Google first, then Google again as a US address, then miles estimated from ZIP or city.
  const measure = async (to: string): Promise<{miles: number; estimated: boolean} | null> => {
    if (!l) return null;
    if (o.distance) {
      try {
        const miles = (await o.distance(l.origin, to)) ?? (await o.distance(`${l.origin}, USA`, `${to}, USA`));
        if (miles) return {miles, estimated: false};
        note = noRouteReason(l.origin, to) ?? 'Google Maps found no driving route for these addresses';
      } catch (e) { note = e instanceof Error ? e.message : 'Google Maps failed'; }
    }
    const est = o.estimate?.(l.origin, to) ?? null;
    return est ? {miles: est, estimated: true} : null;
  };
  const priced: {to: string; q: ReturnType<typeof mileageQuote> | null; estimated: boolean}[] = [];
  for (const to of stops.slice(0, 10)) {
    const m = await measure(to);
    priced.push({to, estimated: !!m?.estimated, q: m ? mileageQuote(card, m.miles, {accessorials: l?.accessorials ?? [], stops: Math.max(0, Math.min(20, l?.extra_stops ?? 0)), roundTrip, drayage}) : null});
  }
  if (priced.some(p => p.q)) {
    const how = drayage ? 'Drayage, priced round trip (to the delivery and back) with chassis.' : roundTrip ? 'Priced round trip, as requested.' : '';
    const conditions = [...new Set(priced.flatMap(p => p.q?.unpriced ?? []))];
    const block = (p: typeof priced[number]) => p.q
      ? `${p.q.lines.map(x => `${x.label}${x.label.startsWith('Linehaul') && p.estimated ? ' (estimated miles)' : ''}: ${usd(x.amount)}`).join('\n')}\nTotal: ${usd(p.q.total)} per load.`
      : 'Priced on confirmation: we could not measure this lane yet.';
    const body = priced.length === 1
      ? `Quote for ${l!.origin} to ${priced[0]!.to} (USD):\n${block(priced[0]!)}`
      : `Quotes from ${l!.origin} (USD), per load:\n\n${priced.map((p, i) => `${i + 1}. To ${p.to}\n${block(p)}`).join('\n\n')}`;
    const after = [conditions.length ? `Rate conditions: ${conditions.join('; ')}.` : '', priced.some(p => p.estimated) ? 'Estimated miles are confirmed before booking.' : '', how].filter(Boolean).join('\n');
    const one = priced.length === 1 ? priced[0]!.q : null;
    const notes = [priced.some(p => !p.q) ? 'Some lanes not measured' : '', priced.some(p => p.estimated) ? `Miles estimated from ZIP/city${note ? ` (${note})` : ''}` : ''].filter(Boolean).join('; ');
    return {method: 'mileage', total: one?.total ?? null, miles: one?.miles ?? null, note: notes || undefined,
      body: sign(`${body}${after ? `\n${after}` : ''}\n\n${TERMS_TOTAL(days)}\n${AVAILABILITY}`)};
  }
  if (l && o.distance && !note) note = 'Google Maps found no driving route for these addresses';
  const lane = l ? `${l.origin} to ${stops.join('; ')}` : '';
  const rates = [`Transportation: ${usd(card.per_mile)} per mile${card.fuel_pct ? `, plus ${card.fuel_pct}% fuel surcharge` : ''}${card.minimum ? `; minimum ${usd(card.minimum)} per load` : ''}. ${drayage ? 'Drayage is billed round trip. ' : ''}Distance and final total subject to lane confirmation.`,
    ...card.accessorials.map(a => `${a.name}: ${usd(a.price)} ${perLabel(a)}.`)];
  return {method: 'unit_rates', total: null, miles: null, note, body: sign(`Our quoted rates (USD)${lane ? ` for ${lane}` : ''}:\n${rates.join('\n')}\n\n${TERMS_UNIT(days)}`)};
}
