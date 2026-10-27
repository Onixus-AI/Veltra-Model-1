import {test} from 'node:test';
import assert from 'node:assert/strict';
import {googleAgentAction} from '../lib/google-agent';
import {appsForTool} from '../lib/task-access-policy';
const W='00000000-0000-4000-8000-000000000001';
function fixture(provider='google'){
 let row:any=null;const writes:string[]=[];let email='owner@example.com',workspace=W,fail=false;
 const client:any={from:()=>{const filters:Record<string,unknown>={};let update:any;const q:any={then:(resolve:any)=>{if(update)Object.assign(row,update);return Promise.resolve({error:null}).then(resolve);},select:()=>q,eq:(k:string,v:unknown)=>{filters[k]=v;return q;},insert:(v:any)=>{row={...v,revision:0};return q;},update:(v:any)=>{update=v;return q;},single:async()=>({data:{id:row.id},error:null}),maybeSingle:async()=>{if(!row||row.user_id!==filters.user_id||row.id!==filters.id||filters.revision!==undefined&&row.revision!==filters.revision)return {data:null};if(update)Object.assign(row,update);return {data:row,error:null};}};return q;}};
 const net:typeof fetch=async(input,init)=>{const u=new URL(String(input));assert.equal(u.origin,'https://mail.example.com');assert.equal((init?.headers as any).Authorization,'Bearer owner');const path=u.pathname.split('/').at(-1);if(path==='')return Response.json({connected:true,account:{email},workspace_id:workspace});
 if(init?.method==='POST'){writes.push(path!);if(fail)throw Error('timeout');if(path==='propose')return Response.json(provider==='google'?{ticket:'private-ticket',kind:'doc',title:'Plan',content:'Hello',account:{email}}:{ticket:'private-ticket',plan:{notified:['guest@example.com']},title:'Meeting',when:{start:'tomorrow'},warnings:[]});return Response.json({saved:true});}
 if(path==='editor')return Response.json({kind:'doc',id:'file-1',content:'original',snapshot:'private-snapshot'});return Response.json({files:[{id:'file-1'}]});};
 const run=(name:string,args:Record<string,unknown>={},confirm?:any,scope:any={workspace_id:W})=>googleAgentAction({client,user:'owner',scope,name,args,confirm,authorization:'Bearer owner',mailOrigin:'https://mail.example.com'},net);
 return {run,writes,get row(){return row;},setEmail:(e:string)=>email=e,setWorkspace:(w:string)=>workspace=w,setFail:()=>fail=true};
}
test('Google and Calendar have distinct task grants, including confirmations',()=>{
 assert.deepEqual(appsForTool('google_edit_file'),['google']);assert.deepEqual(appsForTool('calendar_events'),['calendar']);assert.deepEqual(appsForTool('confirm',{}, {target:'google'}),['google']);assert.deepEqual(appsForTool('confirm',{}, {target:'calendar'}),['calendar']);
});
test('creation waits for review; model cannot select a destination; replay is denied',async()=>{
 const f=fixture();await assert.rejects(()=>f.run('google_create_file',{kind:'doc',title:'Plan',content:'Hello',url:'https://attacker.test'}),/Unsupported/);
 const p=await f.run('google_create_file',{kind:'doc',title:'Plan',content:'Hello'});assert.deepEqual(f.writes,['propose']);assert.match(p.proposal!.summary,/owner@example.com/);assert.doesNotMatch(p.proposal!.summary,/private-ticket/);
 await f.run('confirm',{},p.proposal!.agent_review);assert.deepEqual(f.writes,['propose','create']);await assert.rejects(()=>f.run('confirm',{},p.proposal!.agent_review),/used/);assert.equal(f.writes.length,2);
});
test('account, customer, Workspace and expiry changes invalidate approval',async()=>{
 for(const change of ['account','workspace','customer','expiry']){const f=fixture();const p=await f.run('google_create_file',{kind:'doc',title:'Plan',content:'Hello'});if(change==='account')f.setEmail('other@example.com');if(change==='expiry'){const stored=JSON.parse(f.row.messages[0].content);stored.expires_at=0;f.row.messages[0].content=JSON.stringify(stored);}await assert.rejects(()=>f.run('confirm',{},p.proposal!.agent_review,change==='workspace'?{workspace_id:'other'}:change==='customer'?{workspace_id:W,customer_id:'other'}:{workspace_id:W}),/changed|expired/);assert.deepEqual(f.writes,['propose']);}
});
test('edit review shows original/replacement and keeps freshness snapshot private',async()=>{
 const f=fixture();const p=await f.run('google_edit_file',{id:'file-1',content:'replacement'});assert.equal(f.writes.length,0);assert.match(p.proposal!.summary,/original/);assert.match(p.proposal!.summary,/replacement/);assert.doesNotMatch(p.proposal!.summary,/private-snapshot/);assert.equal(JSON.parse(f.row.messages[0].content).body.snapshot,'private-snapshot');await f.run('confirm',{},p.proposal!.agent_review);assert.deepEqual(f.writes,['save']);
});
test('Calendar enforces selected Workspace and reviews notification recipients',async()=>{
 const f=fixture('calendar');f.setWorkspace('other');await assert.rejects(()=>f.run('calendar_events',{calendar:'primary'}),/different Workspace/);f.setWorkspace(W);const p=await f.run('calendar_change',{action:'cancel',calendar_id:'primary',event_id:'event-1',notify:true});assert.match(p.proposal!.summary,/guest@example.com/);assert.deepEqual(JSON.parse(f.row.messages[0].content).body.notify_confirmed,['guest@example.com']);assert.deepEqual(f.writes,['propose']);await f.run('confirm',{},p.proposal!.agent_review);assert.deepEqual(f.writes,['propose','commit']);
});
test('uncertain writes stay consumed; confirmation cannot send them twice',async()=>{
 const f=fixture();const p=await f.run('google_create_file',{kind:'doc',title:'Plan',content:'Hello'});f.setFail();await assert.rejects(()=>f.run('confirm',{},p.proposal!.agent_review),/Check the file/);assert.equal(f.row.revision,3);await assert.rejects(()=>f.run('confirm',{},p.proposal!.agent_review),/used/);assert.deepEqual(f.writes,['propose','create']);
});
