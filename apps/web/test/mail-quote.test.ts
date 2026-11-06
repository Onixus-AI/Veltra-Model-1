import {test} from 'node:test';
import assert from 'node:assert/strict';
import {estimateMiles, placeOf} from '../lib/mail/places';
import {googleDistance, isDrayage, mileageQuote, validRateCard, writeQuote} from '../lib/mail/quote';

const CARD = {per_mile: 2.5, minimum: 350, fuel_pct: 10, accessorials: [{name: 'Liftgate', price: 75, per: 'flat' as const}, {name: 'Extra stop', price: 75, per: 'stop' as const}, {name: 'Detention', price: 75, per: 'hour' as const}]};

test('a load is priced linehaul + fuel + accessorials asked for, never under the minimum', () => {
  const q = mileageQuote(CARD, 300, {accessorials: ['liftgate', 'detention', 'tarp'], stops: 2});
  assert.deepEqual(q.lines, [{label: 'Linehaul: 300 mi × $2.50/mi', amount: 750}, {label: 'Fuel surcharge (10%)', amount: 75}, {label: 'Liftgate', amount: 75}, {label: 'Extra stop × 2', amount: 150}]);
  assert.equal(q.total, 1050);
  assert.deepEqual(q.unpriced, ['Detention at $75.00/hour if needed', 'tarp: priced on confirmation']);
  assert.equal(mileageQuote(CARD, 20, {accessorials: [], stops: 0}).total, 350);
});

test('every quote carries the disclaimers and the signature; nothing to quote from returns null', async () => {
  const unit = (await writeQuote({lane: null, tms: null, card: CARD, distance: null, signature: 'Onixus Inc'}))!;
  assert.equal(unit.method, 'unit_rates');
  for (const s of ['valid for 3 days', 'not a confirmed all-in shipment total', 'no capacity is reserved', 'Liftgate: $75.00 per flat.', '10% fuel surcharge']) assert.ok(unit.body.includes(s), s);
  assert.ok(unit.body.endsWith('Onixus Inc'));
  const total = (await writeQuote({lane: {origin: 'Norfolk, VA', destination: 'Richmond, VA'}, tms: null, card: CARD, distance: async () => 92.4, signature: 'S', validDays: 5}))!;
  assert.equal(total.method, 'mileage');
  assert.match(total.body, /valid for 5 days/);
  assert.match(total.body, /does not reserve capacity or confirm a booking/);
  assert.equal(await writeQuote({lane: null, tms: null, card: null, distance: null, signature: 'S'}), null);
  const failing = (await writeQuote({lane: {origin: 'a', destination: 'b'}, tms: null, card: CARD, distance: async () => { throw new Error('maps down'); }, signature: 'S'}))!;
  assert.equal(failing.method, 'unit_rates', 'a Maps failure falls back to unit rates');
  assert.equal(failing.note, 'maps down', 'and says why');
  assert.match((await writeQuote({lane: {origin: 'a', destination: 'b'}, tms: null, card: CARD, distance: null, signature: 'S'}))!.note!, /not set up/);
});

test('rate cards are checked; Google distance returns miles or null', async () => {
  assert.ok(validRateCard(CARD));
  assert.ok(!validRateCard({...CARD, per_mile: 0}));
  assert.ok(!validRateCard({...CARD, accessorials: [{name: '', price: 1, per: 'flat'}]}));
  assert.ok(!validRateCard(null));
  const d = googleDistance('k', {fetcher: (async () => Response.json({routes: [{distanceMeters: 160934.4}]})) as typeof fetch});
  assert.equal(Math.round((await d('a', 'b'))!), 100);
  await assert.rejects(googleDistance('k', {fetcher: (async () => Response.json({error: {message: 'Routes API has not been used in project 123'}}, {status: 403})) as typeof fetch})('a', 'b'), /Google Maps 403: Routes API has not been used/);
});

const ONIXUS = {per_mile: 2.5, minimum: 350, fuel_pct: 0, accessorials: [{name: 'Chassis', price: 35, per: 'day' as const, min: 3}, {name: 'Pre-Pull', price: 250, per: 'flat' as const}]};

test('drayage is round trip with a 3-day chassis; OTR is one way unless asked', async () => {
  const d = (await writeQuote({lane: {origin: 'Norfolk International Terminal, VA', destination: 'Lorton, VA 22079', equipment_type: 'CONTAINER', container_size: '40'}, tms: null, card: ONIXUS, distance: async () => 172, signature: 'S'}))!;
  assert.equal(d.total, 965, '172 x 2 x 2.50 = 860 + chassis 3 days x 35 = 105');
  assert.match(d.body, /Chassis: 3 days minimum × \$35\.00\/day: \$105\.00/);
  const otr = (await writeQuote({lane: {origin: 'Charlotte, NC', destination: 'Atlanta, GA', equipment_type: 'DRY_VAN'}, tms: null, card: ONIXUS, distance: async () => 245, signature: 'S'}))!;
  assert.equal(otr.total, 612.5, 'one way, no chassis');
  const rt = (await writeQuote({lane: {origin: 'Charlotte, NC', destination: 'Atlanta, GA', equipment_type: 'FLATBED', round_trip: true}, tms: null, card: ONIXUS, distance: async () => 245, signature: 'S'}))!;
  assert.equal(rt.total, 1225, 'round trip when the request says so');
  assert.ok(isDrayage({origin: 'VIG', destination: 'Greenville, NC'}), 'a terminal name means container work');
  assert.match((await writeQuote({lane: {origin: 'NIT', destination: 'x', equipment_type: 'CONTAINER'}, tms: null, card: ONIXUS, distance: null, signature: 'S'}))!.body, /Chassis: \$35\.00 per day \(3-day minimum\)\.[\s\S]*|Drayage is billed round trip/);
});

test('several destinations are priced one by one; a lane Maps misses is retried, then marked', async () => {
  const miles: Record<string, number> = {'Chantilly, VA 20151': 200, 'Charlotte, NC 28262': 330};
  const calls: string[] = [];
  const q = (await writeQuote({lane: {origin: 'Norfolk Port', destination: 'several', destinations: ['Chantilly, VA 20151', 'Charlotte, NC 28262', 'Nowhere 00000'], equipment_type: 'CONTAINER'},
    tms: null, card: ONIXUS, signature: 'S', distance: async (_f, t) => { calls.push(t); return miles[t] ?? null; }}))!;
  assert.equal(q.method, 'mileage');
  assert.match(q.body, /1\. To Chantilly, VA 20151\n[\s\S]*Total: \$1,105\.00 per load/);
  assert.match(q.body, /2\. To Charlotte, NC 28262\n[\s\S]*Total: \$1,755\.00 per load/);
  assert.match(q.body, /3\. To Nowhere 00000\nPriced on confirmation/);
  assert.ok(calls.includes('Nowhere 00000, USA'), 'retried as a US address');
  assert.equal(q.total, null, 'no single total for several loads');
  assert.match(q.note!, /Some lanes not measured/);
});

test('a day accessorial needs a valid minimum', () => {
  assert.ok(validRateCard(ONIXUS));
  assert.ok(!validRateCard({...ONIXUS, accessorials: [{name: 'Chassis', price: 35, per: 'day', min: 0}]}));
  assert.ok(!validRateCard({...ONIXUS, accessorials: [{name: 'Chassis', price: 35, per: 'week'}]}));
});

test('places: ZIPs, cities, port terminals; estimates only when both ends are placed', () => {
  assert.equal(placeOf('Ashland, VA 23005')?.zip, '23005');
  assert.equal(placeOf('11890 North Lakeridge Pkwy, Ashland, VA 23005')?.zip, '23005', 'a street number is not the ZIP');
  assert.equal(placeOf('NIT')?.zip, '23505');
  assert.equal(placeOf('VIG')?.zip, '23703');
  assert.equal(placeOf('Norfolk Port')?.zip, '23505');
  assert.equal(placeOf('Charleston, WV')?.zip, '25301', 'a city with a state beats the port of the same name');
  const nr = estimateMiles('Norfolk, VA', 'Richmond, VA')!;
  assert.ok(nr > 80 && nr < 110, `Norfolk to Richmond about 94 road miles, got ${nr}`);
  assert.equal(estimateMiles('VIG', 'Boviet / Greenville'), null, 'no state, no guess');
});

test('no Maps route: estimate, and multi-lane notes appear once', async () => {
  const q = (await writeQuote({lane: {origin: 'Norfolk Port', destination: 'x', destinations: ['Chantilly, VA 20151', 'Charlotte, NC 28262'], equipment_type: 'CONTAINER', accessorials: ['overweight (lane 1)']},
    tms: null, card: ONIXUS, signature: 'S', distance: async () => null, estimate: estimateMiles}))!;
  assert.equal(q.method, 'mileage');
  assert.equal(q.body.match(/overweight \(lane 1\)/g)?.length, 1, 'conditions listed once');
  assert.match(q.body, /\(estimated miles\)/);
});

test('the chassis charged is not also listed as priced on confirmation', () => {
  const q = mileageQuote(ONIXUS, 100, {accessorials: ['chassis split', 'storage'], stops: 0, drayage: true});
  assert.ok(q.lines.some(l => l.label.startsWith('Chassis: 3 days')));
  assert.deepEqual(q.unpriced, ['chassis split: priced on confirmation', 'storage: priced on confirmation']);
});

test('a price whose miles look wrong is flagged for a person, never auto-sent', async () => {
  const far = (await writeQuote({lane: {origin: 'Richmond Barge Terminal', destination: 'Chester, VA 23836', equipment_type: 'CONTAINER'}, tms: null, card: ONIXUS, signature: 'S',
    distance: async () => 850, estimate: () => 15}))!;
  assert.match(far.check!, /Google says 850 mi, the ZIP\/city estimate 15 mi/);
  const none = (await writeQuote({lane: {origin: 'Norfolk Port', destination: 'Not specified', equipment_type: 'CONTAINER'}, tms: null, card: ONIXUS, signature: 'S',
    distance: async () => 1881, estimate: () => null}))!;
  assert.match(none.check!, /No delivery place given/);
  const ok = (await writeQuote({lane: {origin: 'NIT', destination: 'Lorton, VA 22079', equipment_type: 'CONTAINER'}, tms: null, card: ONIXUS, signature: 'S',
    distance: async () => 172, estimate: () => 159}))!;
  assert.equal(ok.check, undefined, 'normal Google vs estimate gap is fine');
});
