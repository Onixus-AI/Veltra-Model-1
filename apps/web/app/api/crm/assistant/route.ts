import {crmUser,crmError} from '@/lib/crm/server';
import {runCrmChat,validId} from '@/lib/crm/chat-actions';
import {crmPlanner} from '@/lib/crm/chat-planner';
export const runtime='nodejs';
export const maxDuration=90;
export async function POST(request:Request){try{
 const raw=await request.text();if(raw.length>16000)throw new Error('413:CRM request is too large.');
 let b;try{b=JSON.parse(raw);}catch{throw new Error('400:Invalid CRM request.');}
 if(!b||typeof b!=='object'||!validId(b.workspace_id)||(b.customer_id&&!validId(b.customer_id)))throw new Error('400:Select a workspace and customer.');
 const {client,user}=await crmUser(request);
 if((b.review_id&&b.message)||(!b.review_id&&(typeof b.message!=='string'||!b.message.trim()||b.message.length>3000)))throw new Error('400:Send a message or confirm one review.');
 const origin=process.env.VELTRA_MAIL_URL;
 const outreach=origin?async(body?:Record<string,unknown>)=>{
  const r=await fetch(origin.replace(/\/$/,'')+'/chat/outreach'+(body?'':'?workspace='+encodeURIComponent(b.workspace_id)),{method:body?'POST':'GET',headers:{Authorization:request.headers.get('authorization')!,'Content-Type':'application/json'},body:body?JSON.stringify({...body,workspace_id:b.workspace_id}):undefined,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(25000)});
  const data=await r.json();if(!r.ok)throw new Error(`${[400,401,403,404,409,503].includes(r.status)?r.status:503}:${data.error||'Outreach is unavailable.'}`);return data;
 }:undefined;
 const result=await runCrmChat({client,user:user.id,scope:{workspace_id:b.workspace_id,customer_id:b.customer_id??null},message:b.message,review_id:b.review_id,outreach,plan:crmPlanner(request.headers.get('authorization')!,typeof b.model==='string'?b.model:undefined)});
 return Response.json(result,{headers:{'Cache-Control':'no-store'}});
}catch(e){return crmError(e);}}
