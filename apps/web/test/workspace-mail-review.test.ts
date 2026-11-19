import test from 'node:test';import assert from 'node:assert/strict';
import {workspaceMailBatch,workspaceMailList,confirmWorkspaceMailBatch} from '../lib/workspace-mail-review';

const draft=(id:string,overrides:Record<string,unknown>={})=>({id,status:'pending',updated_at:'2026-11-19T12:00:00Z',category:'QUESTION',from_email:'customer@example.test',subject:'Question',draft:'Here is the answer.',plan:{action:'reply',headline:'Answer customer'},...overrides});
test('Workspace Mail list reports waiting work and excludes owner or quote-review items from bulk',()=>{
 const items=[draft('ready'),draft('owner',{needs_owner:true,owner_reason:'Needs an owner decision'}),draft('quote',{category:'QUOTE_REQUEST',plan:{action:'reply',needs_review:true,quote_check:'No confirmed rate'}}),draft('cleanup',{plan:{action:'trash'}})];
 const list=workspaceMailList(items);assert.equal(list.shown,4);assert.deepEqual(list.items.map(i=>i.ready_for_bulk),[true,false,false,false]);
 const batch=workspaceMailBatch(items);assert.deepEqual(batch.review.selected.map(i=>i.id),['ready']);assert.equal(batch.review.excluded.length,3);assert.match(batch.review.notice,/does not prove sending or delivery/);
});
test('reviewed batch approves only unchanged drafts and reports per-item results',async()=>{
 const originals=[draft('changed'),draft('ready'),draft('failed')],batch=workspaceMailBatch(originals);
 const calls:string[]=[];
 const client={rpc:async(name:string,args:Record<string,unknown>)=>{
  calls.push(name);
  if(name==='mail_items_list')return {data:[draft('changed',{draft:'A new answer.'}),draft('ready'),draft('failed')],error:null};
  if(name==='mail_item_decide')return args.p_id==='failed'?{data:null,error:{message:'Rate missing'}}:{data:{status:'approved'},error:null};
  throw Error('Unexpected RPC');
 }};
 const receipt=await confirmWorkspaceMailBatch(client as never,'workspace',batch.snapshots);
 assert.deepEqual(calls,['mail_items_list','mail_item_decide','mail_item_decide']);
 assert.deepEqual({approved:receipt.approved,skipped:receipt.skipped,failed:receipt.failed},{approved:1,skipped:1,failed:1});
 assert.equal(receipt.status,'partial');assert.match(receipt.notice,/not verified/);
});
