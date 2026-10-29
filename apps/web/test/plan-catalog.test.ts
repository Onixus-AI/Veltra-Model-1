import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PLANS,TOP_UP_PACKS,TRIAL_DAYS,businessMonthlyPriceCents} from '../lib/plan-catalog';
test('Business pricing includes the first seat and charges only additional paid users',()=>{
 assert.equal(businessMonthlyPriceCents(1),9900);assert.equal(businessMonthlyPriceCents(2),13400);assert.equal(businessMonthlyPriceCents(3),16900);
 for(const value of [0,-1,1.5,NaN,Infinity,10001])assert.throws(()=>businessMonthlyPriceCents(value));
});
test('packages retain all four subscription names, trial and separate one-time top-ups',()=>{
 assert.deepEqual(PLANS.map(p=>p.id),['personal','creator','dev','business']);
 assert.deepEqual(TOP_UP_PACKS.map(p=>p.priceCents),[2500,5000]);assert.equal(TRIAL_DAYS,14);
 assert.equal(PLANS[0].priceCents,1999);
 assert.ok(PLANS.filter(p=>p.id!=='business').every(p=>!p.business));
});
test('new allocations and setup choices keep recurring and one-time charges separate',async()=>{
 const {businessMonthlyCredits,BUSINESS_SETUP_PACKAGES}=await import('../lib/plan-catalog');
 assert.deepEqual(PLANS.map(p=>p.credits),[4000,8000,15000,20000]);
 assert.equal(businessMonthlyCredits(1),20000);assert.equal(businessMonthlyCredits(3),34000);
 assert.deepEqual(BUSINESS_SETUP_PACKAGES.map(p=>p.priceCents),[29900,69900]);
 assert.deepEqual(TOP_UP_PACKS.map(p=>p.credits),[5000,12000]);
 assert.ok(PLANS.find(p=>p.id==='business')?.features.includes('Business OS, CRM and Mail automation'));
});
