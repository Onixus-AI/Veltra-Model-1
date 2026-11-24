import test from 'node:test';import assert from 'node:assert/strict';
import {verifyWorkspaceZee,zeeEndpoint,upcoming,eventOverview,listEvents,type ZeeDb,type Identity} from '../../../supabase/zee/functions/workspace-zee/core';
import {zeeAction,ZEE_MCP_URL} from '../lib/zee-agent';
import {toolsForMessages,CHAT_TOOLS} from '../lib/chat-tools';
import {appsForTool,ACCESS_APPS} from '../lib/task-access-policy';

const WS='https://ws.example',W='8350462c-2cca-4541-b299-acbc4c5f1162',U='10000000-0000-4000-8000-000000000001',Z='68f14245-0de5-4a56-b9ff-8106d596643e',E='20000000-0000-4000-8000-000000000002';
const req=(h:Record<string,string>,body:unknown={jsonrpc:'2.0',id:1,method:'tools/list'})=>new Request('https://zee/functions/v1/workspace-zee',{method:'POST',headers:h,body:JSON.stringify(body)});
const goodHeaders={authorization:'Bearer t','x-workspace-public-key':'k','x-workspace-id':W};
function wsFetch(o:{owns?:boolean;confirmed?:boolean}={}){return (async(url:RequestInfo|URL)=>{const u=String(url);
 if(u.endsWith('/auth/v1/user'))return Response.json({id:U,email:'Cara@ZeeEvents.xyz',email_confirmed_at:o.confirmed===false?null:'2026-10-27'});
 if(u.includes('crm_workspaces?'))return Response.json(o.owns===false?[]:[{id:W}]);
 throw Error('unexpected '+u);}) as typeof fetch;}

test('Zee identity: owner + verified email + confirmed Zee login, matched case-insensitively',async()=>{
 let asked='';
 const i=await verifyWorkspaceZee(req(goodHeaders),{workspaceUrl:WS,fetcher:wsFetch(),zeeIdentity:async e=>{asked=e;return {user_id:Z,is_admin:true};}});
 assert.deepEqual(i,{zeeUser:Z,admin:true,email:'cara@zeeevents.xyz',workspace:W});assert.equal(asked,'Cara@ZeeEvents.xyz');
 await assert.rejects(verifyWorkspaceZee(req({...goodHeaders,'x-workspace-id':'nope'}),{workspaceUrl:WS,fetcher:wsFetch(),zeeIdentity:async()=>null}),/Choose a business/);
 await assert.rejects(verifyWorkspaceZee(req(goodHeaders),{workspaceUrl:WS,fetcher:wsFetch({owns:false}),zeeIdentity:async()=>({user_id:Z,is_admin:false})}),/business owner/);
 await assert.rejects(verifyWorkspaceZee(req(goodHeaders),{workspaceUrl:WS,fetcher:wsFetch({confirmed:false}),zeeIdentity:async()=>({user_id:Z,is_admin:false})}),/Verify your Workspace email/);
 await assert.rejects(verifyWorkspaceZee(req(goodHeaders),{workspaceUrl:WS,fetcher:wsFetch(),zeeIdentity:async()=>null}),/No confirmed Zee account/);
});

function fakeDb(){
 const events=[{id:E,name:'Smith wedding',user_id:'other',partner_id:Z,closed_at:null},{id:'30000000-0000-4000-8000-000000000003',name:'Gala',user_id:'other',partner_id:null,closed_at:null}];
 const rows:Record<string,Record<string,unknown>[]>={
  event_tasks:[{event_id:E,title:'Book band',due_date:'2026-11-20',done:false},{event_id:E,title:'Cake tasting',due_date:'2026-11-28',done:false},{event_id:E,title:'Old',due_date:'2026-11-01',done:true}],
  event_timeline:[{event_id:E,title:'Ceremony',time_at:'2026-12-01T17:00:00Z'}],
  event_vendors:[{event_id:E,name:'Florist',balance:400},{event_id:E,name:'DJ',balance:0}],
  event_budget_items:[{event_id:E,category:'Flowers',planned:1000,actual:600}],
 };
 const db:ZeeDb={async events(i:Identity,o){return events.filter(e=>(i.admin||e.user_id===i.zeeUser||e.partner_id===i.zeeUser)&&(!o.id||e.id===o.id));},async rows(t,ids){return rows[t].filter(r=>ids.includes(String(r.event_id)));}};
 return db;
}
const planner:Identity={zeeUser:Z,admin:false,email:'p@x',workspace:W},admin:Identity={...planner,admin:true};

test('planners see only their events; admins see all; reads never include guests or contacts',async()=>{
 const db=fakeDb();
 assert.equal((await listEvents(db,planner)).count,1);assert.equal((await listEvents(db,admin)).count,2);
 await assert.rejects(eventOverview(db,planner,'30000000-0000-4000-8000-000000000003'),/not found/);
 const o=await eventOverview(db,planner,E);
 assert.deepEqual(o.totals,{tasks_open:2,budget_planned:1000,budget_actual:600,vendor_balance_due:400});
 assert.ok(!('guests' in o));
 const u=await upcoming(db,planner,14,new Date('2026-11-24T12:00:00Z')) as unknown as {overdue_tasks:{title:string}[];tasks_due:{title:string}[];timeline:{title:string}[];vendors_with_balance:{name:string}[]};
 assert.deepEqual(u.overdue_tasks.map(t=>t.title),['Book band']);assert.deepEqual(u.tasks_due.map(t=>t.title),['Cake tasting']);
 assert.deepEqual(u.timeline.map(t=>t.title),['Ceremony']);assert.deepEqual(u.vendors_with_balance.map(v=>v.name),['Florist']);
 await assert.rejects(upcoming(db,planner,500),/1 to 90/);
});

test('endpoint checks identity before reading JSON-RPC, and refuses extra arguments',async()=>{
 let read=false;const db={...fakeDb(),async events(){read=true;return [];}} as ZeeDb;
 const denied=await zeeEndpoint(req(goodHeaders),{db,identify:async()=>{throw Object.assign(new (await import('../../../supabase/zee/functions/workspace-zee/core')).ZeeError(403,'Only the business owner can use Zee AI here.'));}});
 assert.equal(denied.status,403);assert.equal(read,false);
 const ok=await zeeEndpoint(req(goodHeaders,{jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'upcoming',arguments:{days:7,user_id:U}}}),{db:fakeDb(),identify:async()=>planner});
 assert.equal((await ok.json()).result.isError,true);
 assert.equal((await zeeEndpoint(new Request('https://z',{method:'GET'}),{db:fakeDb(),identify:async()=>planner})).status,405);
});

test('Onyx Zee tool sends the session and selected business, and surfaces Zee reasons',async t=>{
 const old=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='ws-anon';t.after(()=>{if(old===undefined)delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY=old;});
 const o={client:{} as any,user:U,scope:{workspace_id:W},authorization:'Bearer s'};
 const calls:any[]=[];
 const net=(async(url:RequestInfo|URL,init?:RequestInit)=>{assert.equal(url,ZEE_MCP_URL);const h=init?.headers as Record<string,string>;assert.equal(h['x-workspace-id'],W);assert.equal(h.Authorization,'Bearer s');const b=JSON.parse(String(init?.body));calls.push(b.params);return Response.json({jsonrpc:'2.0',id:b.id,result:{content:[{type:'text',text:JSON.stringify({days:14,tasks_due:[]})}]}});}) as typeof fetch;
 const r=await zeeAction({...o,args:{action:'upcoming',days:14}},net);
 assert.match(r.content,/Zee AI/);assert.deepEqual(calls[0],{name:'upcoming',arguments:{days:14}});
 await assert.rejects(zeeAction({...o,args:{action:'list_events',workspace_id:W}},net),/Unsupported Zee arguments/);
 await assert.rejects(zeeAction({...o,args:{action:'delete_event'}},net),/Use list_events/);
 await assert.rejects(zeeAction({...o,scope:{workspace_id:W,customer_id:U},args:{action:'upcoming'}},net),/own business/);
 const denied=(async()=>Response.json({error:'No confirmed Zee account uses your Workspace email.'},{status:403})) as typeof fetch;
 await assert.rejects(zeeAction({...o,args:{action:'upcoming'}},denied),/^Error: 403:No confirmed Zee account/);
});

test('event questions bring in the Zee tool under its own Zee AI permission',()=>{
 assert.ok(!CHAT_TOOLS.some(x=>x.function.name==='zee_events'));
 const tools=toolsForMessages([{role:'user',content:'What is due on my events this week?'}]);
 assert.ok(tools.length<=32);assert.ok(tools.some(x=>x.function.name==='zee_events'));
 assert.deepEqual(appsForTool('zee_events',{action:'upcoming'}),['zee']);assert.ok((ACCESS_APPS as readonly string[]).includes('zee'));
});

test('Connections: Zee AI card reads linked, needs a Zee account, or owner-only',async t=>{
 const {zeeStatus,CONNECTORS}=await import('../lib/connector-status');const {zeeLinkStatus}=await import('../lib/zee-agent');
 assert.ok(CONNECTORS.some(c=>c.id==='zee'&&c.group==='Business'));
 assert.deepEqual(zeeStatus({linked:true,admin:true}),{state:'connected',account:'Zee admin'});
 assert.equal(zeeStatus({linked:false,reason:'no_zee_account'}).state,'available');
 assert.equal(zeeStatus({linked:false,reason:'not_owner'}).state,'setup');
 assert.equal(zeeStatus(null).state,'unavailable');
 const old=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='ws-anon';t.after(()=>{if(old===undefined)delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY=old;});
 const ok=(async()=>Response.json({jsonrpc:'2.0',id:1,result:{content:[{type:'text',text:JSON.stringify({scope:'All Zee events (admin)',count:0})}]}})) as typeof fetch;
 assert.deepEqual(await zeeLinkStatus(W,'Bearer s',ok),{linked:true,admin:true});
 const none=(async()=>Response.json({error:'No confirmed Zee account uses your Workspace email.'},{status:403})) as typeof fetch;
 assert.deepEqual(await zeeLinkStatus(W,'Bearer s',none),{linked:false,reason:'no_zee_account'});
 assert.deepEqual(await zeeLinkStatus('',`Bearer s`,ok),{linked:false,reason:'choose_business'});
});
