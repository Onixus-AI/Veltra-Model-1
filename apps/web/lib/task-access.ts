import {taskAccessEnabled} from './task-access-config';
import type {SupabaseClient} from '@supabase/supabase-js';
import {crmUser} from './crm/server';
import {APP_NAMES,type AccessApp} from './task-access-policy';
export {ACCESS_APPS,APP_NAMES,appsForTool,type AccessApp} from './task-access-policy';
export async function taskDecision(client:SupabaseClient,user:string,task:unknown,app:AccessApp,now=Date.now()):Promise<'allow'|'deny'|'ask'|'ended'>{
 if(typeof task!=='string'||!(/^[a-f0-9-]{36}$/i.test(task)))return 'ask';
 const {data:t,error}=await client.from('veltra_ai_tasks').select('id,expires_at,completed_at').eq('id',task).eq('user_id',user).maybeSingle();if(error)throw Error('503:Task permissions are unavailable. No app access was granted.');if(!t)return 'ask';if(t.completed_at||!(Date.parse(t.expires_at)>now))return 'ended';
 const {data:g,error:e}=await client.from('veltra_ai_task_access').select('allowed').eq('task_id',task).eq('user_id',user).eq('app',app).maybeSingle();if(e)throw Error('503:Task permissions are unavailable.');return g?g.allowed===true?'allow':'deny':'ask';
}
export async function requireTaskAccess(request:Request,task:unknown,apps:AccessApp[],reason='Use this app for the current task.'):Promise<Response|null>{
 if(!taskAccessEnabled())return null;
 const {client,user}=await crmUser(request);
 for(const app of [...new Set(apps)]){const state=await taskDecision(client,user.id,task,app);if(state==='allow')continue;if(state==='ask')return Response.json({access_required:{app,name:APP_NAMES[app],reason},error:'App access needs your permission for this task.'},{status:428,headers:{'Cache-Control':'no-store'}});return Response.json({error:state==='deny'?`${APP_NAMES[app]} access was denied for this task.`:'This task has ended. Start a new request for app access.'},{status:403,headers:{'Cache-Control':'no-store'}});}
 return null;
}

export class TaskAccessError extends Error{constructor(public response:Response){super('Task app access is required.');}}
export async function assertTaskAccess(request:Request,task:unknown,apps:AccessApp[],reason?:string){const response=await requireTaskAccess(request,task,apps,reason);if(response)throw new TaskAccessError(response);}
export async function assertReviewAccess(request:Request,task:unknown,client:SupabaseClient,user:string,review:string){
 if(!taskAccessEnabled())return;
 const {data,error}=await client.from('crm_conversations').select('messages').eq('id',review).eq('user_id',user).maybeSingle();if(error)throw Error('503:Action review could not be checked.');let action='';try{action=JSON.parse(data?.messages?.[0]?.content??'{}')?.plan?.action??'';}catch{/* Existing action validation will reject a malformed review. */}
 if(/campaign|outreach/.test(action))await assertTaskAccess(request,task,['mail'],'Access Mail for the reviewed campaign action.');
}
