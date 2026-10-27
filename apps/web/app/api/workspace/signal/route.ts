import {createClient} from '@supabase/supabase-js';
import {crmUser,crmError} from '@/lib/crm/server';
import {readJson,uuid,noStore} from '@/lib/revenue/server';
import {verifySignalCode} from '@/lib/crm/signal-link';
export const runtime='nodejs';
async function handle(request:Request){try{
 const {client,user}=await crmUser(request);if(!user.email||!user.email_confirmed_at)throw Error('403:Verify your Workspace email first.');
 const body=await readJson(request,2048);if(!uuid(body.workspace))throw Error('400:Choose a workspace.');
 const {data:workspace,error}=await client.from('crm_workspaces').select('id,owner_id').eq('id',body.workspace).single();
 if(error||!workspace||workspace.owner_id!==user.id)throw Error('403:Only the workspace owner can connect Signal.');
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)throw Error('503:Signal linking is not enabled on this server.');
 const server=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 if(request.method==='DELETE'){
  const {error}=await server.from('crm_signal_connections').delete().eq('workspace_id',workspace.id);
  if(error)throw Error('503:Could not remove Signal link.');return Response.json({connection:null},{headers:noStore});
 }
 const signalKey=process.env.SIGNAL_SUPABASE_PUBLISHABLE_KEY;
 if(!signalKey)throw Error('503:Signal verification is not configured.');
 // Return existing receipt before consuming a new one-time code, making browser retries safe.
 const {data:existing,error:readError}=await client.from('crm_signal_connections').select('business_name,signal_client_id,connected_at').eq('workspace_id',workspace.id).maybeSingle();
 if(readError)throw Error('503:Signal linking database setup is not complete.');if(existing)return Response.json({connection:existing},{headers:noStore});
 const proof=await verifySignalCode(typeof body.code==='string'?body.code:'',workspace.id,user.email,{url:'https://rjwbfkuzgusaoizcmmgf.supabase.co',key:signalKey});
 const {data:connection,error:saveError}=await server.rpc('crm_confirm_signal_connection',{p_user:user.id,p_workspace:workspace.id,p_client:proof.client_id,p_organization:proof.organization_id,p_name:proof.business_name,p_email:proof.email});
 if(saveError)throw Error('409:Could not save this link. This Signal business may already be connected to another workspace. Check Connections before creating another code.');
 return Response.json({connection},{headers:noStore});
 }catch(e){return crmError(e);}}
export const POST=handle;export const DELETE=handle;
