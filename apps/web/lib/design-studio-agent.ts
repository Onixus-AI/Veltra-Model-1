import type {SupabaseClient} from '@supabase/supabase-js';
import type {ToolOutcome} from './chat-tools';
import type {BrainScope} from './shared-brain';

// Onixus Design Studio (Business OS). Talks to the Onixus design-studio-mcp
// connector with the signed-in Workspace session; Onixus verifies that this
// user owns the workspace and that it is linked to their Signal business.
// The model never supplies identity or workspace. Generation always goes
// through an exact review saved here, then one confirmed call.
export const DESIGN_STUDIO_MCP_URL='https://rjwbfkuzgusaoizcmmgf.supabase.co/functions/v1/design-studio-mcp';
const IMAGE_PREFIX='/storage/v1/object/sign/design-studio/';
const REVIEW_TYPE='design_studio_generation';
const REVIEW_MS=600000;
const ACTIONS=['context','list_projects','get_project','create_project','generate_design'] as const;
const FIELDS:Record<(typeof ACTIONS)[number],string[]>={context:[],list_projects:[],get_project:['project_id'],create_project:['name','brief','category'],generate_design:['project_id','kind','request']};
const uuid=(x:unknown):x is string=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(x);
type Options={client:SupabaseClient;user:string;scope:BrainScope;args:Record<string,unknown>;authorization:string;confirm?:{target:string;id:string}};

async function workspaceFor(o:Options){
 if(o.scope.customer_id)throw Error('409:Select the client’s own linked Workspace business, not an agency CRM contact.');
 let workspace=o.scope.workspace_id;
 if(!workspace){const r=await o.client.from('crm_signal_connections').select('workspace_id').limit(2);if(r.error)throw Error('503:Business links unavailable.');if(r.data?.length!==1)throw Error('400:Select a business conversation linked to Onixus.');workspace=r.data[0].workspace_id;}
 if(!uuid(workspace))throw Error('400:Choose a linked Workspace business.');
 return workspace;
}

/** One MCP tools/call against the stateless Onixus connector. */
export async function designStudioCall(workspace:string,authorization:string,tool:string,args:Record<string,unknown>,net:typeof fetch=fetch):Promise<Record<string,unknown>>{
 if(process.env.DESIGN_STUDIO_ENABLED!=='true')throw Error('503:Design Studio is not enabled for Workspace yet.');
 const key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;if(!key)throw Error('503:Design Studio bridge is not configured.');
 const r=await net(DESIGN_STUDIO_MCP_URL,{method:'POST',headers:{Authorization:authorization,'x-workspace-public-key':key,'x-workspace-id':workspace,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:crypto.randomUUID(),method:'tools/call',params:{name:tool,arguments:args}}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(tool==='generate_design'&&args.confirmed===true?180000:20000)});
 const data=await r.json().catch(()=>null);
 if(!r.ok)throw Error(`${[400,401,402,403,404,409,413,429].includes(r.status)?r.status:503}:${typeof data?.error==='string'?data.error:'Design Studio is unavailable.'}`);
 const text=data?.result?.content?.[0]?.text;let parsed:Record<string,unknown>;
 try{parsed=JSON.parse(text);}catch{throw Error('503:Design Studio returned no readable result.');}
 if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error('503:Design Studio returned no readable result.');
 if(data.result.isError)throw Error(`409:${String(parsed.error??'Design Studio could not complete this request.').slice(0,300)}`);
 return parsed;
}

function designImage(asset:unknown){
 const a=asset as {url?:unknown}|null;let image:URL;
 try{image=new URL(String(a?.url));}catch{throw Error('503:Design Studio returned no image preview.');}
 if(image.origin!=='https://rjwbfkuzgusaoizcmmgf.supabase.co'||!image.pathname.startsWith(IMAGE_PREFIX))throw Error('503:Design Studio returned an invalid image preview.');
 return image.toString();
}

export async function designStudioAction(o:Options,net:typeof fetch=fetch):Promise<ToolOutcome>{
 if(o.confirm){
  if(o.confirm.target!=='design'||!uuid(o.confirm.id))throw Error('400:Invalid Design Studio review.');
  const found=await o.client.from('crm_conversations').select('workspace_id,revision,messages').eq('id',o.confirm.id).eq('user_id',o.user).maybeSingle();
  if(found.error||!found.data)throw Error('404:Design review not found.');
  if(found.data.revision!==0)throw Error('409:This design review was already used.');
  let payload:{type?:string;expires_at?:number;args?:Record<string,unknown>}={};try{payload=JSON.parse(found.data.messages?.[0]?.content??'{}');}catch{}
  if(payload.type!==REVIEW_TYPE||!Number.isFinite(payload.expires_at)||Number(payload.expires_at)<=Date.now()||!payload.args)throw Error('409:Design review expired. Ask for a new quote.');
  const workspace=found.data.workspace_id;if(!uuid(workspace)||(o.scope.workspace_id&&o.scope.workspace_id!==workspace))throw Error('409:Return to the business used for this review.');
  // Claim the review before generating so a double click cannot spend two designs.
  const claim=await o.client.from('crm_conversations').update({revision:1}).eq('id',o.confirm.id).eq('user_id',o.user).eq('revision',0).select('id').maybeSingle();
  if(claim.error||!claim.data)throw Error('409:This design review was already used.');
  const result=await designStudioCall(workspace,o.authorization,'generate_design',{...payload.args,confirmed:true},net);
  const url=designImage(result.asset);
  await o.client.from('crm_conversations').update({revision:2,messages:[{role:'assistant',content:JSON.stringify({type:REVIEW_TYPE,receipt:{asset_id:(result.asset as {id?:unknown})?.id??null,designs_left_this_month:result.designs_left_this_month??null}})}]}).eq('id',o.confirm.id).eq('user_id',o.user);
  return {content:JSON.stringify({status:'completed',approval:'confirmed',action:'create_design',receipt:result}),canvas:{kind:'image',title:'Design Studio',content:url}};
 }
 const action=String(o.args.action??'context') as (typeof ACTIONS)[number];
 if(!ACTIONS.includes(action))throw Error('400:Use context, list_projects, get_project, create_project or generate_design.');
 if(Object.keys(o.args).some(k=>k!=='action'&&!FIELDS[action].includes(k)))throw Error('400:Unsupported Design Studio arguments.');
 const args=Object.fromEntries(Object.entries(o.args).filter(([k])=>k!=='action'));
 const workspace=await workspaceFor(o);
 if(action!=='generate_design')return {content:JSON.stringify(await designStudioCall(workspace,o.authorization,action,args,net))};
 // Quote first: Onixus checks the project belongs to this business and returns the allowance.
 const quote=await designStudioCall(workspace,o.authorization,'generate_design',{...args,confirmed:false},net);
 if(quote.needs_confirmation!==true)throw Error('503:Design Studio returned no quote. Nothing was generated.');
 const id=crypto.randomUUID(),expires_at=Date.now()+REVIEW_MS;
 const saved=await o.client.from('crm_conversations').insert({id,user_id:o.user,workspace_id:workspace,customer_id:null,title:'Design Studio review',revision:0,messages:[{role:'assistant',content:JSON.stringify({type:REVIEW_TYPE,expires_at,args})}]}).select('id').single();
 if(saved.error)throw Error('503:Design review could not be saved. Nothing was generated.');
 return {content:'Design quote ready; no image generated yet.',proposal:{id,summary:JSON.stringify({project:quote.project,kind:quote.kind,request:quote.request,inspiration_images_used:quote.inspiration_images_used,uses:quote.uses,designs_left_this_month:quote.designs_left_this_month,expires_at},null,2),agent_review:{target:'design',id}}};
}
