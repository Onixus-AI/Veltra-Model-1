import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PLANS,TOP_UP_PACKS,TRIAL_DAYS,businessMonthlyPriceCents} from '../lib/plan-catalog';
test('Business pricing includes the first seat and charges only additional paid users',()=>{
 assert.equal(businessMonthlyPriceCents(1),7900);assert.equal(businessMonthlyPriceCents(2),10900);assert.equal(businessMonthlyPriceCents(3),13900);
 for(const value of [0,-1,1.5,NaN,Infinity,10001])assert.throws(()=>businessMonthlyPriceCents(value));
});
test('packages retain all four subscription names, trial and separate one-time top-ups',()=>{
 assert.deepEqual(PLANS.map(p=>p.id),['personal','creator','dev','business']);
 assert.deepEqual(TOP_UP_PACKS.map(p=>p.priceCents),[2500,5000]);assert.equal(TRIAL_DAYS,14);
 assert.equal(PLANS[0].priceCents,1199);
 assert.ok(PLANS.filter(p=>p.id!=='business').every(p=>!p.business));
});
