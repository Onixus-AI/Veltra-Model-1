import {crmUser,crmError} from '@/lib/crm/server';
import {agentAction,agentScope} from '@/lib/agent-actions';
export const runtime='nodejs';
export const maxDuration=300;
export async function POST(request:Request){try{
 const raw=await request.text();if(raw.length>20000)throw Error('413:Tool request is too large.');
 let b;try{b=JSON.parse(raw);}catch{throw Error('400:Invalid tool request.');}if(!b||typeof b!=='object'||Array.isArray(b)||typeof b.name!=='string'||!b.args||typeof b.args!=='object'||Array.isArray(b.args))throw Error('400:Invalid tool request.');
 if(b.confirm&&(!['crm','brain','mail'].includes(b.confirm.target)||typeof b.confirm.id!=='string'))throw Error('400:Invalid review.');
 const {client,user}=await crmUser(request),scope=await agentScope(client,user.id,b);
 return Response.json(await agentAction({client,user:user.id,scope,name:b.name,args:b.args,confirm:b.confirm,authorization:request.headers.get('authorization')!,mailOrigin:process.env.VELTRA_MAIL_URL}),{headers:{'Cache-Control':'no-store'}});
}catch(e){return crmError(e);}}
