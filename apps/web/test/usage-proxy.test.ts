import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import type {SupabaseClient} from '@supabase/supabase-js';
const {workspaceUsageReport}=createRequire(import.meta.url)('../lib/workspace-usage-report.ts') as typeof import('../lib/workspace-usage-report');

test('usage reads only the authenticated organization and keeps reservations separate',async()=>{
 const queried:string[]=[];
 const rows:Record<string,Record<string,unknown>[]>={usage_logs:[{id:'usage-1',category:'workspace.crm',model_used:'model-a',tokens_consumed:18,credits_deducted:2,created_at:'2026-11-16T12:00:00Z'}],agent_runs:[{id:'job-1',status:'running',credits_reserved:10,credits_used:3,created_at:'2026-11-16T13:00:00Z'}],credit_transactions:[{id:'ledger-1',amount:-2,description:'CRM request',created_at:'2026-11-16T12:00:00Z'}],mail_credit_requests:[{id:'mail-1',status:'reserved',credits_reserved:4,created_at:'2026-11-16T13:00:00Z'}]};
 const db={from(table:string){const query={select(){return query;},eq(key:string,value:unknown){if(key==='organization_id')assert.equal(value,'11111111-1111-4111-8111-111111111111');return query;},gte(){return query;},lt(){return query;},order(){return query;},range(){queried.push(table);return Promise.resolve({data:rows[table]??[],error:null});}};return query;}} as unknown as SupabaseClient;
 const result=await workspaceUsageReport(db,'11111111-1111-4111-8111-111111111111','2026-11','2026-11-16',new Date('2026-11-17T00:00:00Z'));
 assert.deepEqual(queried.sort(),['agent_runs','credit_transactions','mail_credit_requests','usage_logs']);
 assert.equal(result.used,5);
 assert.equal(result.reserved_remaining,11);
 assert.equal(result.mail_reserved_remaining,4);
 assert.equal(result.events.length,2);
 assert.equal(result.consumption.find(day=>day.date==='2026-11-16')?.credits,5);
});

test('usage rejects a day outside the selected month before querying receipts',async()=>{
 const db={from(){throw Error('should not query');}} as unknown as SupabaseClient;
 await assert.rejects(workspaceUsageReport(db,'org','2026-11','2026-12-01'),/Day must belong/);
});
