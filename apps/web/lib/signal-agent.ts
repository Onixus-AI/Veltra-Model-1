import type {SupabaseClient} from '@supabase/supabase-js';
import type {ToolOutcome} from './chat-tools';
import type {BrainScope} from './shared-brain';
type Options={client:SupabaseClient;user:string;scope:BrainScope;args:Record<string,unknown>;authorization:string;confirm?:{target:string;id:string}};
const uuid=(x:unknown):x is string=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(x);
export async function signalAgentAction(o:Options,net:typeof fetch=fetch):Promise<ToolOutcome>{
 if(o.confirm&&o.confirm.target!=='signal')throw Error('400:Invalid Signal review.');
 if(process.env.SIGNAL_WORKSPACE_SSO_ENABLED!=='true')throw Error('503:Signal Workspace access is not enabled.');
 if(o.scope.customer_id)throw Error('409:Select the client’s own linked Workspace business, not an agency CRM contact.');
 let workspace=o.scope.workspace_id;
 if(!workspace){const r=await o.client.from('crm_signal_connections').select('workspace_id').limit(2);if(r.error)throw Error('503:Signal links unavailable.');if(r.data?.length!==1)throw Error('400:Select a business conversation with its Signal link.');workspace=r.data[0].workspace_id;}
 if(!uuid(workspace))throw Error('400:Choose a linked Workspace business.');
 const key=process.env.SIGNAL_SUPABASE_PUBLISHABLE_KEY,workspaceKey=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
 if(!key||!workspaceKey)throw Error('503:Signal bridge is not configured.');
 const args=o.args;
 if(!o.confirm&&Object.keys(args).some(k=>!['action','brief','id'].includes(k)))throw Error('400:Unsupported Signal arguments.');
 const action=o.confirm?'generate':String(args.action??'context');
 if(!['context','library','propose','result','generate'].includes(action)||(!o.confirm&&action==='generate'))throw Error('400:Use a reviewed Signal proposal before generation.');
 const id=o.confirm?.id??args.id;if(['result','generate'].includes(action)&&!uuid(id))throw Error('400:Choose a returned Signal request ID.');
 const r=await net('https://rjwbfkuzgusaoizcmmgf.supabase.co/functions/v1/workspace-signal-creative',{method:'POST',headers:{Authorization:o.authorization,apikey:key,'x-workspace-public-key':workspaceKey,'Content-Type':'application/json'},body:JSON.stringify({workspace,action,...(action==='propose'?{brief:args.brief}:{}),...(['result','generate'].includes(action)?{id}:{}),...(o.confirm?{confirmed:true}:{})}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(action==='generate'?180000:20000)});
 const data=await r.json().catch(()=>null);
 if(!r.ok||!data?.ok||data.scope?.workspace_id!==workspace||!uuid(data.scope?.client_id))throw Error(`${[400,401,402,403,404,409].includes(r.status)?r.status:503}:${data?.error??'Signal returned no verified receipt. Use result with the request ID before retrying.'}`);
 if(['generate','result'].includes(action)&&data.receipt?.request_id!==id)throw Error('503:Signal returned a different creative request.');
 if(action==='propose'){
  if(!uuid(data.receipt?.request_id)||data.receipt.status!=='proposed')throw Error('503:Signal returned no saved proposal.');
  return {content:'Creative proposal saved; no image generated yet.',proposal:{id:data.receipt.request_id,summary:JSON.stringify({business:data.scope.business_name,brand:data.receipt.brand,brief:data.receipt.brief,scope:data.receipt.scope},null,2),agent_review:{target:'signal',id:data.receipt.request_id}}};
 }
 if(['generate','result'].includes(action)&&data.receipt?.status==='in_review'){
  const artifact=data.receipt.artifact;
  if(!uuid(artifact?.queue_id)||typeof artifact.storage_path!=='string'||!artifact.storage_path.startsWith(data.scope.client_id+'/'))throw Error('503:Signal returned an invalid asset receipt.');
  let image:URL;try{image=new URL(artifact.image_url);}catch{throw Error('503:Signal returned no image preview.');}
  if(image.origin!=='https://rjwbfkuzgusaoizcmmgf.supabase.co'||!image.pathname.startsWith('/storage/v1/object/sign/signal-content-images/'))throw Error('503:Signal returned an invalid image preview.');
  return {content:JSON.stringify({status:'completed',approval:'confirmed',action:action==='generate'?'create_signal_draft':'verify_signal_draft',receipt:data}),canvas:{kind:'image',title:'Signal draft — awaiting review',content:image.toString()}};
 }
 return {content:JSON.stringify(data),...(data.receipt?.status==='failed'?{failed:true}:{})};
}
