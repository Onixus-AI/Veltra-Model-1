import test from 'node:test';import assert from 'node:assert/strict';
import {designStudioAction,DESIGN_STUDIO_MCP_URL} from '../lib/design-studio-agent';
import {toolsForMessages,CHAT_TOOLS} from '../lib/chat-tools';
import {appsForTool} from '../lib/task-access-policy';

const W='8350462c-2cca-4541-b299-acbc4c5f1162',P='20000000-0000-4000-8000-000000000002',U='10000000-0000-4000-8000-000000000001';
const IMAGE='https://rjwbfkuzgusaoizcmmgf.supabase.co/storage/v1/object/sign/design-studio/c/p/flat/x.png?token=t';

function setup(t:any){for(const [key,value] of [['DESIGN_STUDIO_ENABLED','true'],['NEXT_PUBLIC_SUPABASE_ANON_KEY','workspace-anon']]){const old=process.env[key];process.env[key]=value;t.after(()=>{if(old===undefined)delete process.env[key];else process.env[key]=old;});}}

/** In-memory crm_conversations with just the query shapes the agent uses. */
function fakeClient(){
 const rows=new Map<string,any>();
 const client:any={rows,from(table:string){assert.equal(table,'crm_conversations');const q:any={filters:{} as Record<string,unknown>,patch:null as any,row:null as any};
  const api:any={
   insert(row:any){q.row=row;return api;},
   update(patch:any){q.patch=patch;return api;},
   select(){return api;},
   eq(k:string,v:unknown){q.filters[k]=v;return api;},
   async single(){rows.set(q.row.id,{...q.row});return {data:{id:q.row.id},error:null};},
   async maybeSingle(){const r=rows.get(String(q.filters.id));if(!r||Object.entries(q.filters).some(([k,v])=>r[k]!==v))return {data:null,error:null};if(q.patch){Object.assign(r,q.patch);}return {data:{...r},error:null};},
   then(resolve:any){const r=rows.get(String(q.filters.id));if(r&&q.patch&&Object.entries(q.filters).every(([k,v])=>r[k]===v))Object.assign(r,q.patch);resolve({error:null});},
  };return api;}};
 return client;
}

function mcp(calls:any[],result:(args:any)=>unknown){
 return (async(url:RequestInfo|URL,init?:RequestInit)=>{
  assert.equal(url,DESIGN_STUDIO_MCP_URL);
  const h=init?.headers as Record<string,string>;assert.equal(h.Authorization,'Bearer workspace-user');assert.equal(h['x-workspace-id'],W);assert.equal(h['x-workspace-public-key'],'workspace-anon');
  const body=JSON.parse(String(init?.body));assert.equal(body.method,'tools/call');calls.push(body.params);
  return Response.json({jsonrpc:'2.0',id:body.id,result:{content:[{type:'text',text:JSON.stringify(result(body.params.arguments))}]}});
 }) as typeof fetch;
}

const opts=(client:any)=>({client,user:U,scope:{workspace_id:W},authorization:'Bearer workspace-user'});

test('generation is quoted, reviewed, then generated exactly once with the saved arguments',async t=>{
 setup(t);const calls:any[]=[],client=fakeClient();
 const net=mcp(calls,a=>a.confirmed?{asset:{id:'g1',url:IMAGE},designs_left_this_month:59}:{needs_confirmation:true,project:'Spring capsule',kind:a.kind,request:a.request,uses:1,designs_left_this_month:60});
 const quoted=await designStudioAction({...opts(client),args:{action:'generate_design',project_id:P,kind:'flat',request:'Linen shirt'}},net);
 assert.equal(quoted.proposal?.agent_review?.target,'design');
 assert.deepEqual(calls[0],{name:'generate_design',arguments:{project_id:P,kind:'flat',request:'Linen shirt',confirmed:false}});
 const done=await designStudioAction({...opts(client),args:{},confirm:quoted.proposal!.agent_review!},net);
 assert.deepEqual(calls[1],{name:'generate_design',arguments:{project_id:P,kind:'flat',request:'Linen shirt',confirmed:true}});
 assert.equal(done.canvas?.kind,'image');assert.equal(done.canvas?.content,IMAGE);
 await assert.rejects(designStudioAction({...opts(client),args:{},confirm:quoted.proposal!.agent_review!},net),/already used/);
 assert.equal(calls.length,2);
});

test('identity, extra fields, agency contacts and off-bucket previews are refused',async t=>{
 setup(t);const never=(async()=>{throw Error('Network must not run');}) as typeof fetch,client=fakeClient();
 await assert.rejects(designStudioAction({...opts(client),args:{action:'list_projects',client_id:U}},never),/Unsupported Design Studio arguments/);
 await assert.rejects(designStudioAction({...opts(client),args:{action:'delete_project'}},never),/Use context/);
 await assert.rejects(designStudioAction({...opts(client),scope:{workspace_id:W,customer_id:U},args:{action:'context'}},never),/client’s own linked/);
 const calls:any[]=[];
 const quote=await designStudioAction({...opts(client),args:{action:'generate_design',project_id:P,request:'x'}},mcp(calls,a=>a.confirmed?{asset:{url:'https://evil.example/x.png'}}:{needs_confirmation:true}));
 await assert.rejects(designStudioAction({...opts(client),args:{},confirm:quote.proposal!.agent_review!},mcp(calls,()=>({asset:{url:'https://evil.example/x.png'}}))),/invalid image preview/);
});

test('connector stays off until enabled, and Onixus tool errors surface their reason',async t=>{
 const client=fakeClient();
 await assert.rejects(designStudioAction({...opts(client),args:{action:'context'}},(async()=>{throw Error('no');}) as typeof fetch),/not enabled/);
 setup(t);
 const failing=(async(_u:RequestInfo|URL,init?:RequestInit)=>{const b=JSON.parse(String(init?.body));return Response.json({jsonrpc:'2.0',id:b.id,result:{isError:true,content:[{type:'text',text:JSON.stringify({error:'This month\'s design allowance is used up.'})}]}});}) as typeof fetch;
 await assert.rejects(designStudioAction({...opts(client),args:{action:'context'}},failing),/allowance is used up/);
 const denied=(async()=>Response.json({error:'The workspace owner must connect an existing Signal business first.'},{status:403})) as typeof fetch;
 await assert.rejects(designStudioAction({...opts(client),args:{action:'list_projects'}},denied),/^Error: 403:The workspace owner/);
});

test('design requests bring the tool into the 32-tool catalog and ask under the Signal link',()=>{
 assert.ok(!CHAT_TOOLS.some(x=>x.function.name==='design_studio'));
 const tools=toolsForMessages([{role:'user',content:'Design three colorways of the linen shirt from my inspiration'}]);
 assert.ok(tools.length<=32);assert.ok(tools.some(x=>x.function.name==='design_studio'));
 assert.ok(!toolsForMessages([{role:'user',content:'What is on my calendar?'}]).some(x=>x.function.name==='design_studio'));
 assert.deepEqual(appsForTool('design_studio',{action:'context'}),['signal']);
 assert.deepEqual(appsForTool('design_studio',{},{target:'design'}),['signal']);
});

test('Business OS platforms: Design Studio opens the live studio and Zee AI asks for access',async()=>{
 const {platforms,DESIGN_STUDIO_URL}=await import('../lib/business-os-platforms');
 assert.equal(DESIGN_STUDIO_URL,'https://www.onixus.xyz/workspace/design-studio');
 assert.equal(platforms.design.action.href,DESIGN_STUDIO_URL);
 assert.equal(platforms.zee.name,'Zee AI');assert.match(platforms.zee.action.href,/^mailto:info@onixus\.xyz/);
 const {readFileSync}=await import('node:fs');
 assert.match(readFileSync(new URL('../components/business-os-canvas.tsx',import.meta.url),'utf8'),/Onixus Design Studio/);
});
