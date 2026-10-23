import {requireTaskAccess,assertTaskAccess,assertReviewAccess,TaskAccessError,appsForTool} from '@/lib/task-access';
import {crmUser,crmError} from '@/lib/crm/server';
import {agentAction,agentScope} from '@/lib/agent-actions';
import {currentTime} from '@/lib/runtime-context';
export const runtime='nodejs';
export const maxDuration=300;
export async function POST(request:Request){try{
 const raw=await request.text();if(raw.length>20000)throw Error('413:Tool request is too large.');
 let b;try{b=JSON.parse(raw);}catch{throw Error('400:Invalid tool request.');}if(!b||typeof b!=='object'||Array.isArray(b)||typeof b.name!=='string'||!b.args||typeof b.args!=='object'||Array.isArray(b.args))throw Error('400:Invalid tool request.');
 if(b.confirm&&(!['crm','brain','mail'].includes(b.confirm.target)||typeof b.confirm.id!=='string'))throw Error('400:Invalid review.');
 const apps=appsForTool(b.name,b.args,b.confirm);if(apps.length){const required=await requireTaskAccess(request,b.task_id,apps,'Use the requested app tool for this task.');if(required)return required;}
 const {client,user}=await crmUser(request);
 if(b.name==='current_time')return Response.json({content:JSON.stringify(currentTime(b.args.time_zone))},{headers:{'Cache-Control':'no-store'}});
 if(b.confirm?.target==='crm')await assertReviewAccess(request,b.task_id,client,user.id,b.confirm.id);const scope=await agentScope(client,user.id,b);
 return Response.json(await agentAction({client,user:user.id,scope,name:b.name,args:b.args,confirm:b.confirm,authorization:request.headers.get('authorization')!,mailOrigin:process.env.VELTRA_MAIL_URL,appAccess:apps=>assertTaskAccess(request,b.task_id,apps)}),{headers:{'Cache-Control':'no-store'}});
}catch(e){if(e instanceof TaskAccessError)return e.response;return crmError(e);}}
