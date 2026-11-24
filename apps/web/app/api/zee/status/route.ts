import {crmUser,crmError} from '@/lib/crm/server';
import {noStore} from '@/lib/revenue/server';
import {zeeLinkStatus} from '@/lib/zee-agent';
export const runtime='nodejs';
/** Connections card status: is the selected business linked to Zee? Zee checks ownership and the email match. */
export async function GET(request:Request){try{
 await crmUser(request);
 const workspace=new URL(request.url).searchParams.get('workspace')??'';
 return Response.json(await zeeLinkStatus(workspace,request.headers.get('authorization')!),{headers:noStore});
}catch(e){return crmError(e);}}
