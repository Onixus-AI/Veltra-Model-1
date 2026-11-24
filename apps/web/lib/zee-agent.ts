import type {SupabaseClient} from '@supabase/supabase-js';
import type {ToolOutcome} from './chat-tools';
import type {BrainScope} from './shared-brain';

// Zee AI (Business OS). Onyx reads events through the workspace-zee connector on the Zee
// project with the signed-in Workspace session. Zee checks business ownership and that
// the verified Workspace email has a confirmed Zee login. Read only; the model never
// supplies identity or workspace.
export const ZEE_MCP_URL='https://dpcqgnpoznisqkwkkzhx.supabase.co/functions/v1/workspace-zee';
const ACTIONS={list_events:[],event_overview:['event_id'],upcoming:['days']} as const;
type Action=keyof typeof ACTIONS;
const uuid=(x:unknown):x is string=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(x);
type Options={client:SupabaseClient;user:string;scope:BrainScope;args:Record<string,unknown>;authorization:string};

async function workspaceFor(o:Options){
 if(o.scope.customer_id)throw Error('409:Select your own business conversation, not a CRM contact.');
 let workspace=o.scope.workspace_id;
 if(!workspace){const r=await o.client.from('crm_workspaces').select('id').eq('owner_id',o.user).limit(2);if(r.error)throw Error('503:Businesses unavailable.');if(r.data?.length!==1)throw Error('400:Select the business conversation that uses Zee.');workspace=r.data[0].id;}
 if(!uuid(workspace))throw Error('400:Choose a business.');
 return workspace;
}

export async function zeeAction(o:Options,net:typeof fetch=fetch):Promise<ToolOutcome>{
 const action=String(o.args.action??'upcoming') as Action;
 if(!(action in ACTIONS))throw Error('400:Use list_events, event_overview or upcoming.');
 if(Object.keys(o.args).some(k=>k!=='action'&&!(ACTIONS[action] as readonly string[]).includes(k)))throw Error('400:Unsupported Zee arguments.');
 const key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;if(!key)throw Error('503:Zee connection is not configured.');
 const workspace=await workspaceFor(o);
 const args=Object.fromEntries(Object.entries(o.args).filter(([k])=>k!=='action'));
 const r=await net(ZEE_MCP_URL,{method:'POST',headers:{Authorization:o.authorization,'x-workspace-public-key':key,'x-workspace-id':workspace,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:crypto.randomUUID(),method:'tools/call',params:{name:action,arguments:args}}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000)});
 const data=await r.json().catch(()=>null);
 if(!r.ok)throw Error(`${[400,401,403,404,413].includes(r.status)?r.status:503}:${typeof data?.error==='string'?data.error:'Zee is unavailable.'}`);
 const text=data?.result?.content?.[0]?.text;let parsed:Record<string,unknown>;
 try{parsed=JSON.parse(text);}catch{throw Error('503:Zee returned no readable result.');}
 if(data.result.isError)throw Error(`409:${String(parsed?.error??'Zee could not complete this request.').slice(0,300)}`);
 return {content:JSON.stringify({source:'Zee AI',...parsed})};
}
