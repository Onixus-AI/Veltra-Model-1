import {crmUser,crmError} from '@/lib/crm/server';
export async function GET(request:Request){
 try{
  const {client,user}=await crmUser(request);
  const {data,error}=await client.from('crm_workspaces').select('id').limit(1);
  if(error)throw new Error('503:CRM is temporarily unavailable.');
  // A UI preference only. Existing membership policies still authorize every record.
  return Response.json({connected:user.user_metadata?.veltra_crm_connected===true,available:true,has_workspace:Boolean(data?.length)},{headers:{'Cache-Control':'no-store'}});
 }catch(error){return crmError(error);}
}
