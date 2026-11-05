import {test} from 'node:test';
import assert from 'node:assert/strict';
import {googleDistance, mileageQuote, validRateCard, writeQuote} from '../lib/mail/quote';

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
