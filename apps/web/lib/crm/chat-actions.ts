import type {SupabaseClient} from '@supabase/supabase-js';
export type CrmScope={workspace_id:string;customer_id?:string|null};
export type CrmPlan={action:string;args:Record<string,unknown>};
export type CrmReply={kind:'result'|'preview';reply:string;review_id?:string;details?:unknown;changed?:boolean};
export const validId=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const stages=['new','qualified','meeting','proposal','won','lost'];
const help='I can show customers, open or overdue tasks, pipeline and customer history; add customers, tasks, opportunities and proposed memories; complete tasks, update deal stages and suppress outreach. I can also show outreach campaigns and review campaign pause or activation. Select a workspace and, for customer work, a customer. Changes are previewed before confirmation.';
const text=(value:unknown,max:number,required=true)=>{if(typeof value!=='string'||value.length>max||(required&&!value.trim()))throw new Error('400:Check the action details.');return value.trim();};
export function validatePlan(raw:unknown):CrmPlan{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('400:Invalid CRM action.');
 const p=raw as CrmPlan,a=p.args??{};
 if(!a||typeof a!=='object'||Array.isArray(a))throw new Error('400:Invalid action details.');
 const actions=['help','customers','tasks','overdue','pipeline','summary','history','create_customer','create_task','create_deal','propose_memory','complete_task','update_stage','suppress','outreach','pause_campaign','activate_campaign'];
 if(!actions.includes(p.action))throw new Error('400:That CRM action is not supported.');
 // Construct a fresh allowlisted payload. Never accept a table, owner or workspace from model output.
 const args:Record<string,unknown>={};
 if(p.action==='create_customer'){args.company=text(a.company,200);args.name=text(a.name??'',160,false);args.email=text(a.email??'',254,false).toLowerCase();if(args.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(args.email)))throw new Error('400:Enter a valid customer email.');}
 if(p.action==='customers'&&a.query)args.query=text(a.query,100);
 if(p.action==='create_task'){args.title=text(a.title,300);if(typeof a.due_at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(a.due_at)||!Number.isFinite(Date.parse(a.due_at)))throw new Error('400:Provide an explicit due date and time with a time zone.');args.due_at=new Date(a.due_at).toISOString();}
 if(p.action==='create_deal'){args.title=text(a.title,300);if(!Number.isSafeInteger(a.value_cents)||Number(a.value_cents)<0||Number(a.value_cents)>10000000000)throw new Error('400:Provide a valid opportunity value in cents.');args.value_cents=a.value_cents;args.currency=text(a.currency??'USD',3);if(!/^[A-Z]{3}$/.test(String(args.currency)))throw new Error('400:Use a three-letter currency.');}
 if(p.action==='propose_memory')args.content=text(a.content,2000);
 if(['complete_task','update_stage','pause_campaign','activate_campaign'].includes(p.action)){if(validId(a.id))args.id=a.id;else if(['complete_task','update_stage'].includes(p.action)&&a.title)args.title=text(a.title,300);else if(['pause_campaign','activate_campaign'].includes(p.action)&&a.name)args.name=text(a.name,120);else throw new Error('400:Name a specific record from the results.');}
 if(p.action==='update_stage'){if(!stages.includes(String(a.stage).toLowerCase()))throw new Error('400:Choose a supported deal stage.');args.stage=String(a.stage).toLowerCase();}
 return {action:p.action,args};
}
/** Common commands work without model configuration. Other wording can use the bounded planner. */
export function directCrmPlan(message:string):CrmPlan|null{
 const s=message.trim().replace(/^(?:crm\s*[:,-]?\s*)/i,'').replace(/[.!?]$/,'');
 const commands:[RegExp,string][]=[[/^(?:help|what can you do)$/i,'help'],[/^(?:show|list)(?: my| our| all)? customers$/i,'customers'],[/^(?:show|list)(?: my| our)?(?: open)? tasks$/i,'tasks'],[/^(?:show|list)(?: my| our)? overdue tasks$/i,'overdue'],[/^(?:show|list)(?: my| our)?(?: sales)? pipeline$/i,'pipeline'],[/^(?:summarize|show)(?: this| the)?(?: customer)?(?: account| summary)$/i,'summary'],[/^(?:show|list)(?: this| the)?(?: customer)?(?: history| activity)$/i,'history'],[/^(?:show|list)(?: my| our)?(?: outreach)? campaigns$/i,'outreach'],[/^(?:suppress|stop) outreach(?: for this customer)?$/i,'suppress']];
 for(const [re,action] of commands)if(re.test(s))return {action,args:{}};
 const find=/^(?:find|search)(?: customer[s]?)?\s+(.+)$/i.exec(s);if(find)return validatePlan({action:'customers',args:{query:find[1]}});
 const customer=/^(?:add|create) customer\s+(.+?)(?:\s+email\s+([^\s]+))?$/i.exec(s);if(customer)return validatePlan({action:'create_customer',args:{company:customer[1],email:customer[2]??''}});
 const task=/^(?:add|create) task\s+(.+?)\s+due\s+(\d{4}-\d{2}-\d{2}T\S+)$/i.exec(s);if(task)return validatePlan({action:'create_task',args:{title:task[1],due_at:task[2]}});
 const deal=/^(?:add|create) (?:deal|opportunity)\s+(.+?)\s+(?:worth|value)\s+(\d+(?:\.\d{1,2})?)\s+([A-Z]{3})$/i.exec(s);if(deal)return validatePlan({action:'create_deal',args:{title:deal[1],value_cents:Math.round(Number(deal[2])*100),currency:deal[3].toUpperCase()}});
 const memory=/^(?:remember|save memory)\s+(.+)$/i.exec(s);if(memory)return validatePlan({action:'propose_memory',args:{content:memory[1]}});
 const complete=/^complete task\s+(.+)$/i.exec(s);if(complete)return validatePlan({action:'complete_task',args:validId(complete[1])?{id:complete[1]}:{title:complete[1]}});
 const stage=/^move (?:deal|opportunity)\s+(.+?)\s+to\s+(\w+)$/i.exec(s);if(stage)return validatePlan({action:'update_stage',args:{...(validId(stage[1])?{id:stage[1]}:{title:stage[1]}),stage:stage[2]}});
 const campaign=/^(pause|activate) campaign\s+(.+)$/i.exec(s);if(campaign)return validatePlan({action:campaign[1].toLowerCase()+'_campaign',args:validId(campaign[2])?{id:campaign[2]}:{name:campaign[2]}});
 return null;
}
const readActions=new Set(['help','customers','tasks','overdue','pipeline','summary','history','outreach']);
async function rows(query:PromiseLike<{data:unknown;error:unknown}>){const r=await query;if(r.error)throw r.error;return r.data;}
export async function runCrmChat(o:{client:SupabaseClient;user:string;scope:CrmScope;message?:string;review_id?:string;plan?:(message:string)=>Promise<unknown>;outreach?:(body?:Record<string,unknown>)=>Promise<unknown>;now?:number}):Promise<CrmReply>{
 const {client,user,scope}=o,now=o.now??Date.now();
 if(!validId(scope.workspace_id)||(scope.customer_id&&!validId(scope.customer_id)))throw new Error('400:Select a valid CRM workspace and customer.');
 const membership=await rows(client.from('crm_memberships').select('role').eq('workspace_id',scope.workspace_id).eq('user_id',user).maybeSingle()) as {role:string}|null;
 if(!membership)throw new Error('403:You do not have access to this workspace.');
 if(scope.customer_id){const c=await rows(client.from('crm_customers').select('id').eq('workspace_id',scope.workspace_id).eq('id',scope.customer_id).maybeSingle());if(!c)throw new Error('404:Customer not found in this workspace.');}
 const inScope=(table:string,fields='*')=>{let q=client.from(table).select(fields).eq('workspace_id',scope.workspace_id);if(scope.customer_id)q=q.eq(table==='crm_customers'?'id':'customer_id',scope.customer_id);return q;};
 let plan:CrmPlan,review:{id:string;record_id:string;before?:unknown}|undefined;
 if(o.review_id){
  if(!validId(o.review_id))throw new Error('400:Invalid action review.');
  const row=await rows(client.from('crm_conversations').select('id,user_id,workspace_id,customer_id,messages,revision').eq('id',o.review_id).eq('user_id',user).eq('workspace_id',scope.workspace_id).maybeSingle()) as {id:string;customer_id:string|null;revision:number;messages:{content:string}[]}|null;
  if(!row||row.revision!==0||(row.customer_id??null)!==(scope.customer_id??null))throw new Error('409:This review was used or its workspace/customer changed. Request a new preview.');
  let payload;try{payload=JSON.parse(row.messages[0].content);}catch{throw new Error('400:Invalid action review.');}
  if(payload.type!=='crm_action_review'||!Number.isFinite(payload.expires_at)||payload.expires_at<=now||!validId(payload.record_id))throw new Error('409:Action review expired. Request a new preview.');
  plan=validatePlan(payload.plan);review={id:row.id,record_id:payload.record_id,before:payload.before};
 }else{
  const message=text(o.message,3000);plan=directCrmPlan(message)??(o.plan?validatePlan(await o.plan(message)):{action:'help',args:{}});
 }
 if(readActions.has(plan.action)){
  if(review)throw new Error('400:Read actions cannot be confirmed.');
  let details:unknown;
  if(plan.action==='help')return {kind:'result',reply:help};
  if(plan.action==='customers'){let q=inScope('crm_customers','id,company,name,email,suppressed');if(plan.args.query)q=q.ilike('company','%'+String(plan.args.query).replace(/[%_\\]/g,'\\$&')+'%');details=await rows(q.order('company').limit(100));}
  if(['tasks','overdue'].includes(plan.action)){let q=inScope('crm_tasks','id,customer_id,title,due_at,status').eq('status','open');if(plan.action==='overdue')q=q.lt('due_at',new Date(now).toISOString());details=await rows(q.order('due_at').limit(100));}
  if(plan.action==='pipeline')details=await rows(inScope('crm_deals','id,customer_id,title,stage,value_cents,currency').order('created_at',{ascending:false}).limit(100));
  if(plan.action==='history')details=await rows(inScope('crm_activity','id,customer_id,kind,title,created_at').order('created_at',{ascending:false}).limit(50));
  if(plan.action==='summary')details={customers:await rows(inScope('crm_customers','id,company,name,email,suppressed').limit(100)),tasks:await rows(inScope('crm_tasks','id,customer_id,title,due_at,status').eq('status','open').limit(100)),deals:await rows(inScope('crm_deals','id,customer_id,title,stage,value_cents,currency').limit(100)),memories:await rows(inScope('crm_memories','customer_id,content,source,expires_at').eq('status','approved').or(`expires_at.is.null,expires_at.gt.${new Date(now).toISOString()}`).limit(30))};
  if(plan.action==='outreach'){if(!o.outreach)throw new Error('503:Outreach is not configured.');details=await o.outreach();}
  return {kind:'result',reply:`CRM ${plan.action} · current workspace${scope.customer_id?' / selected customer':''}. Results are bounded; this is not an exhaustive export.`,details};
 }
 if(!['owner','member'].includes(membership.role))throw new Error('403:Your CRM role is read-only.');
 if(plan.action!=='create_customer'&&!['pause_campaign','activate_campaign'].includes(plan.action)&&!scope.customer_id)throw new Error('400:Select the customer before changing their records.');
 if(['pause_campaign','activate_campaign'].includes(plan.action)&&membership.role!=='owner')throw new Error('403:Only the workspace owner can control outreach.');
 if(plan.args.title&&['complete_task','update_stage'].includes(plan.action)){
  const matches=await rows(inScope(plan.action==='complete_task'?'crm_tasks':'crm_deals','id').ilike('title',String(plan.args.title).replace(/[%_\\]/g,'\\$&')).limit(2)) as {id:string}[];
  if(matches.length!==1)throw new Error('400:That title is missing or ambiguous for this customer. Choose a unique record.');
  plan={action:plan.action,args:{id:matches[0].id,...(plan.action==='update_stage'?{stage:plan.args.stage}:{})}};
 }
 if(plan.args.name&&['pause_campaign','activate_campaign'].includes(plan.action)){
  if(!o.outreach)throw new Error('503:Outreach is not configured.');
  const state=await o.outreach() as {campaigns?:{id:string;name:string}[]},matches=(state.campaigns??[]).filter(c=>c.name.toLowerCase()===String(plan.args.name).toLowerCase());
  if(matches.length!==1)throw new Error('400:That campaign name is missing or ambiguous. Choose a unique campaign.');
  plan={action:plan.action,args:{id:matches[0].id}};
 }
 let before:unknown=null;
 if(['complete_task','update_stage'].includes(plan.action)){
  before=await rows(inScope(plan.action==='complete_task'?'crm_tasks':'crm_deals',plan.action==='complete_task'?'id,title,status':'id,title,stage').eq('id',plan.args.id).maybeSingle());
  if(!before)throw new Error('404:Record not found for this customer.');
 }
 if(plan.action==='suppress')before=await rows(client.from('crm_customers').select('id,company,suppressed').eq('workspace_id',scope.workspace_id).eq('id',scope.customer_id!).single());
 if(['pause_campaign','activate_campaign'].includes(plan.action)){
  if(!o.outreach)throw new Error('503:Outreach is not configured.');
  const state=await o.outreach() as {campaigns?:{id:string;status:string;name:string}[]};before=state.campaigns?.find(c=>c.id===plan.args.id);if(!before)throw new Error('404:Campaign not found.');
 }
 if(!review){
  const id=crypto.randomUUID(),record_id=crypto.randomUUID(),expires_at=now+600000;
  await rows(client.from('crm_conversations').insert({id,user_id:user,workspace_id:scope.workspace_id,customer_id:scope.customer_id??null,title:'CRM action review',messages:[{role:'assistant',content:JSON.stringify({type:'crm_action_review',plan,record_id,before,expires_at})}]}).select('id').single());
  return {kind:'preview',review_id:id,reply:'Review this CRM change. Nothing has changed yet. Confirm to apply it; this review expires in ten minutes.',details:{action:plan.action,...plan.args,customer_id:scope.customer_id??null,before,expires_at:new Date(expires_at).toISOString()}};
 }
 if(JSON.stringify(before)!==JSON.stringify(review.before??null))throw new Error('409:The record changed since preview. Request a new preview.');
 const claim=await rows(client.from('crm_conversations').update({revision:1}).eq('id',review.id).eq('user_id',user).eq('workspace_id',scope.workspace_id).eq('revision',0).select('id').maybeSingle());
 if(!claim)throw new Error('409:This review has already been confirmed.');
 try{
  let details:unknown;
  const base={id:review.record_id,workspace_id:scope.workspace_id,customer_id:scope.customer_id};
  if(plan.action==='create_customer')details=await rows(client.from('crm_customers').insert({id:review.record_id,workspace_id:scope.workspace_id,...plan.args,email:plan.args.email||null,source:'Veltra Chat'}).select('id,company').single());
  if(plan.action==='create_task')details=await rows(client.from('crm_tasks').insert({...base,...plan.args,action_key:review.id}).select('id,title').single());
  if(plan.action==='create_deal')details=await rows(client.from('crm_deals').insert({...base,...plan.args,stage:'qualified'}).select('id,title').single());
  if(plan.action==='propose_memory')details=await rows(client.from('crm_memories').insert({...base,...plan.args,source:'Proposed in Veltra Chat',status:'proposed',action_key:review.id}).select('id,status').single());
  if(plan.action==='complete_task')details=await rows(client.from('crm_tasks').update({status:'done'}).eq('id',plan.args.id).eq('workspace_id',scope.workspace_id).eq('customer_id',scope.customer_id!).eq('status',(before as {status:string}).status).select('id,status').single());
  if(plan.action==='update_stage')details=await rows(client.from('crm_deals').update({stage:plan.args.stage}).eq('id',plan.args.id).eq('workspace_id',scope.workspace_id).eq('customer_id',scope.customer_id!).eq('stage',(before as {stage:string}).stage).select('id,stage').single());
  if(plan.action==='suppress')details=await rows(client.from('crm_customers').update({suppressed:true}).eq('id',scope.customer_id!).eq('workspace_id',scope.workspace_id).eq('suppressed',(before as {suppressed:boolean}).suppressed).select('id,suppressed').single());
  if(['pause_campaign','activate_campaign'].includes(plan.action))details=await o.outreach!({action:plan.action==='pause_campaign'?'pause':'activate',id:plan.args.id});
  const result:CrmReply={kind:'result',reply:plan.action==='propose_memory'?'Memory proposed for review; it is not approved customer memory.':'CRM change saved. No email was sent by this chat action. Campaign activation allows previously approved messages to be delivered by the existing scheduler.',details,changed:true};
  await client.from('crm_conversations').update({revision:2,messages:[{role:'assistant',content:JSON.stringify(result)}]}).eq('id',review.id).eq('user_id',user);
  return result;
 }catch{throw new Error('409:The action result needs review. Refresh CRM before trying again; this confirmation cannot be reused.');}
}
