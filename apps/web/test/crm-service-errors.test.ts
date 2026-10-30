import {test} from 'node:test';import assert from 'node:assert/strict';
import {crmError} from '../lib/crm/server';
test('known Mail and browser service failures retain their source and status',async()=>{
 for(const [code,message] of [[502,'Mail returned no action receipt.'],[503,'The browser runtime is unavailable.'],[429,'Daily search allowance reached.'],[504,'Page inspection timed out.']] as const){const r=crmError(new Error(code+':'+message));assert.equal(r.status,code);assert.equal((await r.json()).error,message);}
});
test('unexpected database errors do not leak internal details',async()=>{
 const r=crmError({message:'private database details',code:'42703'});assert.equal(r.status,502);assert.doesNotMatch((await r.json()).error,/private database/);
});
