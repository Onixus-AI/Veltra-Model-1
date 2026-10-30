import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readSnapshot} from '../lib/crm/snapshot';
import {crmDeadline} from '../lib/crm/request';
test('snapshot preserves full totals, stable page order and bounded page concurrency',async()=>{
 let inFlight=0,maximum=0;const offsets:number[]=[];
 const client={from:(table:string)=>{let offset=0;const q:any={select:()=>q,eq:()=>q,is:(column:string,value:unknown)=>{assert.equal(column,'archived_at');assert.equal(value,null);return q;},order:()=>q,range:(start:number)=>{offset=start;return q;},abortSignal:()=>q,then:async(resolve:any)=>{if(table!=='crm_customers')return resolve({data:[],count:0,error:null});inFlight++;maximum=Math.max(maximum,inFlight);offsets.push(offset);await new Promise(r=>setTimeout(r,offset===500?15:1));inFlight--;const total=2101;return resolve({data:Array.from({length:Math.min(500,total-offset)},(_,i)=>({id:offset+i})),count:total,error:null});}};return q;}};
 const result=await readSnapshot(client as any,'workspace');assert.equal(result.customers.length,2101);assert.deepEqual(result.customers.map(row=>row.id),Array.from({length:2101},(_,i)=>i));assert.ok(maximum<=3);assert.equal(maximum,3);assert.deepEqual(offsets,[0,500,1000,1500,2000]);
});
test('snapshot errors do not produce a misleading partial result and deadlines release stalled UI',async()=>{
 const q:any={select:()=>q,eq:()=>q,is:(column:string,value:unknown)=>{assert.equal(column,'archived_at');assert.equal(value,null);return q;},order:()=>q,range:()=>q,abortSignal:()=>q,then:(resolve:any)=>resolve({data:null,error:{message:'Unavailable'}})};
 await assert.rejects(readSnapshot({from:()=>q} as any,'workspace'),/could not finish loading/);
 await assert.rejects(crmDeadline(new Promise(()=>{}),undefined,5),/did not finish/);
 const controller=new AbortController();const pending=crmDeadline(new Promise(()=>{}),controller.signal,100);controller.abort();await assert.rejects(pending,/did not finish/);
});

test('workspace creation reuses the authenticated RPC and validates its receipt',async()=>{
 const {createWorkspace}=await import('../lib/crm/workspaces');const calls:unknown[]=[];const id='00000000-0000-4000-8000-000000000001';
 const client={rpc:async(name:string,args:unknown)=>{calls.push({name,args});return {data:id,error:null};}};
 assert.deepEqual(await createWorkspace(client as any,' Test business ',' Transport '),{id,name:'Test business',industry:'Transport'});
 assert.deepEqual(calls,[{name:'crm_create_workspace',args:{p_name:'Test business',p_industry:'Transport'}}]);
 await assert.rejects(createWorkspace(client as any,' ','Transport'),/Enter a business/);assert.equal(calls.length,1);
 await assert.rejects(createWorkspace({rpc:async()=>({data:null,error:{message:'Unavailable'}})} as any,'Test','Transport'),/could not be confirmed/);
});
