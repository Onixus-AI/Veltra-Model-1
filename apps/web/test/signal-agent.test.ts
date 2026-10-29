import test from 'node:test';import assert from 'node:assert/strict';
import {signalAgentAction} from '../lib/signal-agent';import {toolsForMessages,CHAT_TOOLS} from '../lib/chat-tools';import {appsForTool} from '../lib/task-access-policy';import {verifiedAnswer} from '../lib/completion-evidence';
const W='8350462c-2cca-4541-b299-acbc4c5f1162',C='679cae69-806e-4691-9ef3-241a7ab86501',ID='10000000-0000-4000-8000-000000000001';
const brief={scene:'A real office',headline:'Better work',subheading:'',caption:'Book a call.',platform:'instagram',format:'square'};
const opts={client:{} as any,user:ID,scope:{workspace_id:W},authorization:'Bearer fixture'};
function setup(t:any){for(const key of ['SIGNAL_WORKSPACE_SSO_ENABLED','SIGNAL_SUPABASE_PUBLISHABLE_KEY','NEXT_PUBLIC_SUPABASE_ANON_KEY']){const old=process.env[key];process.env[key]=key==='SIGNAL_WORKSPACE_SSO_ENABLED'?'true':'fixture';t.after(()=>{if(old===undefined)delete process.env[key];else process.env[key]=old;});}}
test('Signal creates a review before generation and passes only the saved ID on confirmation',async t=>{
 setup(t);const calls:any[]=[];
 const net=async(url:RequestInfo|URL,init?:RequestInit)=>{assert.equal(url,'https://rjwbfkuzgusaoizcmmgf.supabase.co/functions/v1/workspace-signal-creative');const body=JSON.parse(String(init?.body));calls.push(body);assert.equal(body.workspace,W);return Response.json({ok:true,scope:{workspace_id:W,client_id:C,business_name:'Onixus'},receipt:body.action==='propose'?{request_id:ID,status:'proposed',brand:{business_name:'Onixus'},brief,scope:'One reviewed draft'}:{request_id:ID,status:'in_review',artifact:{queue_id:ID,storage_path:C+'/workspace/'+ID+'.jpg',image_url:'https://rjwbfkuzgusaoizcmmgf.supabase.co/storage/v1/object/sign/signal-content-images/'+C+'/workspace/'+ID+'.jpg?token=fixture'}}});};
 const proposal=await signalAgentAction({...opts,args:{action:'propose',brief}},net as typeof fetch);
 assert.equal(proposal.proposal?.agent_review?.target,'signal');assert.deepEqual(calls.map(x=>x.action),['propose']);
 const completed=await signalAgentAction({...opts,args:{},confirm:proposal.proposal?.agent_review},net as typeof fetch);
 assert.deepEqual(calls[1],{workspace:W,action:'generate',id:ID,confirmed:true});assert.equal(completed.canvas?.kind,'image');
 assert.match(verifiedAnswer('I saved the draft.',[{tool:'signal_creative',content:completed.content}]),/Verified action receipts/);
});
test('tenant selection, unsupported direct generation and customer-contact scope are rejected before network',async t=>{
 setup(t);const net=async()=>{throw Error('Network must not run');};
 await assert.rejects(signalAgentAction({...opts,args:{action:'context',client_id:C}},net),/Unsupported Signal/);
 await assert.rejects(signalAgentAction({...opts,args:{action:'generate',id:ID}},net),/reviewed Signal proposal/);
 await assert.rejects(signalAgentAction({...opts,scope:{workspace_id:W,customer_id:ID},args:{action:'context'}},net),/client’s own linked/);
});
test('task-scoped Signal catalog stays within 32 tools and retains explicitly requested infrastructure tools',()=>{
 assert.equal(CHAT_TOOLS.length,32);
 for(const text of ['Use Signal to read my saved brand','Create campaign images and inspect n8n','Check Signal and Railway']){
  const tools=toolsForMessages([{role:'user',content:text}]);assert.equal(tools.length,32);assert.ok(tools.some(x=>x.function.name==='signal_creative'));
  if(text.includes('n8n'))assert.ok(tools.some(x=>x.function.name==='n8n_project'));
 }
 assert.deepEqual(appsForTool('signal_creative'),['signal']);assert.deepEqual(appsForTool('confirm',{}, {target:'signal'}),['signal']);
});
