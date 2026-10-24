import {crmActionIntent,executeCrmAction} from '@/lib/crm-actions-chat';
import {taskAccessEnabled} from '@/lib/task-access-config';
import {assertTaskAccess,assertReviewAccess,TaskAccessError,taskDecision} from '@/lib/task-access';
import {brainIntent,brainMessageScope,runBrain,recallBrain} from '@/lib/shared-brain';
import {crmUser,crmError} from '@/lib/crm/server';
import {runCrmChat,validId,directCrmPlan} from '@/lib/crm/chat-actions';
import {crmPlanner} from '@/lib/crm/chat-planner';
export const runtime='nodejs';
export const maxDuration=90;
export async function POST(request:Request){try{
 const raw=await request.text();if(raw.length>16000)throw new Error('413:CRM request is too large.');
 let b;try{b=JSON.parse(raw);}catch{throw new Error('400:Invalid CRM request.');}
 if(!b||typeof b!=='object'||!validId(b.workspace_id)||(b.customer_id&&!validId(b.customer_id)))throw new Error('400:Select a workspace and customer.');
 await assertTaskAccess(request,b.task_id,['crm']);
 const {client,user}=await crmUser(request);
 if(b.review_id)await assertReviewAccess(request,b.task_id,client,user.id,b.review_id);
 if((b.review_id&&b.message)||(!b.review_id&&(typeof b.message!=='string'||!b.message.trim()||b.message.length>3000)))throw new Error('400:Send a message or confirm one review.');
 const campaign=b.message?crmActionIntent(b.message):null;
 if(campaign?.action==='campaign_brief')return Response.json({kind:'result',campaign_url:'/crm?'+new URLSearchParams({view:'Automation',workspace:b.workspace_id,industry:campaign.industry,pillar:'suite'}).toString(),reply:await executeCrmAction(client,user.id,b.workspace_id,campaign,{authorization:request.headers.get('authorization')!,operation:crypto.randomUUID()})},{headers:{'Cache-Control':'no-store'}});
 const origin=process.env.VELTRA_MAIL_URL;
 const outreach=origin?async(body?:Record<string,unknown>)=>{
  await assertTaskAccess(request,b.task_id,['mail']);
  const r=await fetch(origin.replace(/\/$/,'')+'/chat/outreach'+(body?'':'?workspace='+encodeURIComponent(b.workspace_id)),{method:body?'POST':'GET',headers:{Authorization:request.headers.get('authorization')!,'Content-Type':'application/json'},body:body?JSON.stringify({...body,workspace_id:b.workspace_id}):undefined,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(25000)});
  const data=await r.json();if(!r.ok)throw new Error(`${[400,401,403,404,409,503].includes(r.status)?r.status:503}:${data.error||'Outreach is unavailable.'}`);return data;
 }:undefined;
 const scope=brainMessageScope(b.message??'',{workspace_id:b.workspace_id,customer_id:b.customer_id??null});
 const memoryPlan=b.message?brainIntent(b.message):null;
 let memoryReview=false;
 if(b.review_id){const {data,error}=await client.from('crm_conversations').select('title').eq('id',b.review_id).eq('user_id',user.id).maybeSingle();if(error)throw error;memoryReview=data?.title==='Shared brain review';}
 if(memoryPlan||memoryReview){await assertTaskAccess(request,b.task_id,['brain']);return Response.json(await runBrain({client,user:user.id,scope,plan:memoryPlan??undefined,review_id:memoryReview?b.review_id:undefined,app:b.source_app==='mail'?'mail':'crm'}),{headers:{'Cache-Control':'no-store'}});}
 const result=await runCrmChat({client,user:user.id,scope:{workspace_id:b.workspace_id,customer_id:b.customer_id??null},message:b.message,review_id:b.review_id,outreach,plan:crmPlanner(request.headers.get('authorization')!,typeof b.model==='string'?b.model:undefined)});
 if(b.message&&directCrmPlan(b.message)?.action==='summary'&&(!taskAccessEnabled()||await taskDecision(client,user.id,b.task_id,'brain')==='allow')){try{const shared=await recallBrain(client,user.id,scope);result.details={...(result.details as object),shared_memories:shared};}catch{/* The independent shared-brain setup may not be applied yet. */}}
 return Response.json(result,{headers:{'Cache-Control':'no-store'}});
}catch(e){if(e instanceof TaskAccessError)return e.response;return crmError(e);}}
