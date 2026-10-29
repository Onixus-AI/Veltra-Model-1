import test from 'node:test';
import assert from 'node:assert/strict';
import {businessPeriod} from '../lib/business-period';
test('business period starts at local midnight including DST and uses Monday for weeks',()=>{
 assert.equal(businessPeriod('today','America/New_York',new Date('2026-11-01T16:00:00Z')).from,'2026-11-01T04:00:00.000Z');
 assert.equal(businessPeriod('week','America/New_York',new Date('2026-10-29T21:00:00Z')).from,'2026-10-26T04:00:00.000Z');
 assert.equal(businessPeriod('month','America/New_York',new Date('2026-10-29T21:00:00Z')).from,'2026-10-01T04:00:00.000Z');
});
