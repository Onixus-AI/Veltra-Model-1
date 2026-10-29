import {crmUser,crmError} from '@/lib/crm/server';
import {uuid,noStore} from '@/lib/revenue/server';
import {signalAgentAction} from '@/lib/signal-agent';
export const runtime='nodejs';
// Read-only view of the existing creative bridge. Its verified owner/email link remains authoritative.
export async function GET(request:Request){try{
 const workspace=new URL(request.url).searchParams.get('workspace');if(!uuid(workspace))throw Error('400:Choose a business.');
 const {client,user}=await crmUser(request);
 const {data:owned,error}=await client.from('crm_workspaces').select('id,owner_id').eq('id',workspace).single();
 if(error||owned?.owner_id!==user.id)throw Error('403:Only the linked business owner can view Signal activity.');
 const read=async(action:'context'|'library')=>{
  const result=await signalAgentAction({client,user:user.id,scope:{workspace_id:workspace},args:{action},authorization:request.headers.get('authorization')!});
  const data=JSON.parse(result.content);if(data.scope?.workspace_id!==workspace)throw Error('503:Signal returned a different business.');return data;
 };
 const results=await Promise.allSettled([read('context'),read('library')]);
 const context=results[0],library=results[1];
 return Response.json({workspace,policy:context.status==='fulfilled'?{production_mode:context.value.receipt.production_mode,autopublish:context.value.receipt.tools?.autopublish}:null,items:library.status==='fulfilled'?library.value.receipt.items:null,unavailable:results.flatMap((r,i)=>r.status==='rejected'?[i===0?'Signal policy':'Signal content']:[]),checked_at:new Date().toISOString(),limit:30},{headers:noStore});
}catch(e){return crmError(e);}}
