import {crmUser,crmError} from '@/lib/crm/server';
import {uuid,noStore} from '@/lib/revenue/server';
export async function GET(request:Request){try{
 const workspace=new URL(request.url).searchParams.get('workspace');if(!uuid(workspace))throw Error('400:Choose a business.');
 const {client}=await crmUser(request);
 const [overview,priorities,customers]=await Promise.all([client.rpc('revenue_overview',{p_workspace:workspace,p_from:null,p_to:null}),client.rpc('revenue_priorities',{p_workspace:workspace,p_limit:8}),client.from('crm_customers').select('id',{count:'exact',head:true}).eq('workspace_id',workspace)]);
 if(overview.error||priorities.error||customers.error)throw Error('503:Business summary is unavailable. Refresh to retry.');
 return Response.json({workspace,overview:overview.data,priorities:priorities.data,customers:customers.count},{headers:noStore});
}catch(e){return crmError(e);}}
