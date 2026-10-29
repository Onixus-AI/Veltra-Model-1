import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import type {ToolOutcome} from './chat-tools';
/** Metadata audit must never cause a successful tool write to be retried. */
export async function recordBusinessTool(client:SupabaseClient,user:string,workspace:string|undefined|null,tool:string,outcome?:ToolOutcome){
 if(!workspace)return;
 try{
  const member=await client.from('crm_memberships').select('role').eq('workspace_id',workspace).eq('user_id',user).abortSignal(AbortSignal.timeout(2000)).maybeSingle();if(member.error||!member.data)return;
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key)return;
  let completed=false;try{const result=JSON.parse(outcome?.content??'{}');completed=result.status==='completed'&&result.approval==='confirmed';}catch{}
  const status=!outcome||outcome.failed?'failed':outcome.proposal?'review':completed?'completed':'observed';
  const server=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {error}=await server.from('workspace_business_events').insert({workspace_id:workspace,actor_id:user,tool:tool.slice(0,100),status}).abortSignal(AbortSignal.timeout(3000));
  if(error)console.warn('Business tool event was not persisted.');
 }catch{console.warn('Business tool event was not persisted.');}
}
