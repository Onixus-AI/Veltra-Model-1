import {prepareImport} from '@/lib/crm/bulk-import';
import {contactWorker} from '@/lib/crm/contact-worker';
import {runDiscovery} from "@/lib/crm/discovery";
import {crmUser,crmError,crmContext} from '@/lib/crm/server';
import {checkedMessages} from '@/lib/crm/suite-domain';
export const runtime='nodejs';
export const maxDuration=120;
type Context={params:Promise<{path:string[]}>};
const uuid=(s:unknown)=>typeof s==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(s);
async function handle(request:Request,context:Context){try{
 const {path}=await context.params;
 if(path.length===1&&path[0]==='contact-worker'){if(request.method!=='POST')return Response.json({error:'Method not allowed'},{status:405});return contactWorker(request);}
 const {client,user}=await crmUser(request),url=new URL(request.url),method=request.method;
 const ok=(data:unknown)=>Response.json(data,{headers:{'Cache-Control':'no-store'}});
 const body=async()=>{const raw=await request.text();if(raw.length>500000)throw new Error('413:Request is too large.');try{return JSON.parse(raw);}catch{throw new Error('400:Invalid JSON.');}};
 if(path[0]==='contact-research'&&path.length===1){
  if(method==='POST'){const b=await body();if(!uuid(b.workspace_id)||!uuid(b.customer_id)||typeof b.website!=='string')throw Error('400:Choose a customer and its company website.');const {data,error}=await client.rpc('crm_request_contact_research',{p_workspace:b.workspace_id,p_customer:b.customer_id,p_website:b.website});if(error)throw Error('409:Research could not be queued. Check ownership, company website and the daily limit.');return ok({job_id:data,status:'queued'});}
  if(method==='GET'){const w=url.searchParams.get('workspace'),c=url.searchParams.get('customer');if(!uuid(w)||!uuid(c))throw Error('400:Choose a customer.');const [evidence,jobs]=await Promise.all([client.from('crm_contact_evidence').select('email,source_url,source_kind,observed_at,verification').eq('workspace_id',w).eq('customer_id',c).order('observed_at',{ascending:false}).limit(30),client.from('crm_contact_research').select('id,status,last_error,created_at,completed_at').eq('workspace_id',w).eq('customer_id',c).order('created_at',{ascending:false}).limit(5)]);if(evidence.error||jobs.error)throw Error('503:Contact enrichment is not available yet.');return ok({evidence:evidence.data,jobs:jobs.data});}
 }
 if(path[0]==='business-search'&&path.length===1&&method==='POST'){
  const b=await body();if(!uuid(b.workspace))throw Error('400:Choose a business workspace.');
  const text=(key:string,max:number)=>{if(typeof b[key]!=='string'||!b[key].trim()||b[key].length>max)throw Error('400:Choose an industry and country.');return b[key].trim();};
  const industry=text('industry',200),country=text('country',100),city=typeof b.city==='string'?b.city.trim():'';if(city.length>200)throw Error('400:Location is too long.');
  if(!process.env.FIRECRAWL_API_KEY)throw Error('503:Business search is not configured. Connect the research provider first.');
  const {data:owner}=await client.from('crm_workspaces').select('owner_id').eq('id',b.workspace).single();if(owner?.owner_id!==user.id)throw Error('403:Only this business owner can run provider-backed research.');
  const {data:created,error}=await client.from('crm_discovery_requests').insert({workspace_id:b.workspace,source_type:'directories',query:industry,location:[city,country].filter(Boolean).join(', ')}).select('id').single();if(error||!created)throw Error('503:Search request could not be saved.');
  return ok({request_id:created.id,...await runDiscovery(client,user.id,created.id,10,process.env.FIRECRAWL_API_KEY)});
 }
 if(path[0]==='business-import'&&path.length===1&&method==='POST'){
  const b=await body();if(!uuid(b.workspace))throw Error('400:Choose a business workspace.');
  if(b.action==='prepare')return ok(await prepareImport(client,user.id,b.workspace,b.rows));
  if(b.action==='confirm'&&uuid(b.review_id)){
   const {data:review,error}=await client.from('crm_conversations').select('workspace_id').eq('id',b.review_id).eq('user_id',user.id).eq('title','CRM bulk import review').single();if(error||review?.workspace_id!==b.workspace)throw Error('409:Import review belongs to a different business or user.');
   const result=await client.rpc('crm_confirm_bulk_import',{p_review:b.review_id});if(result.error)throw Error('409:Import could not complete. Check the review and your business role.');
   if(result.data?.status!=='completed'||result.data.review_id!==b.review_id||result.data.workspace_id!==b.workspace)throw Error('503:Import returned no verified receipt.');return ok(result.data);
  }
  throw Error('400:Choose a valid import action.');
 }
 if(path[0]==='discovery'&&path.length===1){
  if(method==='GET')return ok({configured:Boolean(process.env.FIRECRAWL_API_KEY),daily_limit:5});
  if(method==='POST'){const b=await body();if(!uuid(b.id))throw new Error('400:Choose a research request.');return ok(await runDiscovery(client,user.id,b.id,Number(b.limit??10),process.env.FIRECRAWL_API_KEY??''));}
 }
 if(path[0]==='outreach'&&path.length===1&&['GET','POST'].includes(method)){
  const origin=process.env.VELTRA_MAIL_URL;if(!origin)throw new Error('503:Mail is not configured.');
  const workspace=url.searchParams.get('workspace');if(method==='GET'&&!uuid(workspace))throw new Error('400:Choose a workspace.');
  const upstream=await fetch(origin.replace(/\/$/,'')+'/chat/outreach'+(method==='GET'?'?workspace='+encodeURIComponent(workspace!):''),{method,headers:{Authorization:request.headers.get('authorization')!,'Content-Type':'application/json'},body:method==='POST'?JSON.stringify(await body()):undefined,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(30000)});
  return new Response(upstream.body,{status:upstream.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
 }
 if(path[0]==='quote-outcomes'&&path.length===1&&method==='GET'){
  const workspace=url.searchParams.get('workspace');if(!uuid(workspace))throw new Error('400:Choose a workspace.');
  const {data,error}=await client.from('crm_mail_threads').select('thread_id,subject,customer_id,quote_outcome').eq('workspace_id',workspace).not('quote_outcome','is',null).order('last_event_at',{ascending:false}).limit(50);if(error)throw error;return ok({items:data??[],scope:'Latest 50 synced quote threads in this authorized workspace.'});
 }
 if(path[0]==='mail'&&path.length===1){
  const origin=process.env.VELTRA_MAIL_URL;if(!origin)throw new Error('503:Mail is not configured.');
  const upstream=await fetch(origin.replace(/\/$/,'')+'/chat/crm',{method,headers:{Authorization:request.headers.get('authorization')!,'Content-Type':'application/json'},body:method==='POST'?JSON.stringify(await body()):undefined,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
  return new Response(upstream.body,{status:upstream.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
 }
 if(path[0]==='customer-actions'&&path.length===1&&method==='POST'){
  const b=await body();if(!uuid(b.conversation_id)||!uuid(b.action_key)||!['task','memory'].includes(b.kind)||typeof b.content!=='string'||!b.content.trim()||b.content.length>(b.kind==='task'?300:2000))throw new Error('400:Check the customer action.');
  const {data:conversation,error:e}=await client.from('crm_conversations').select('workspace_id,customer_id').eq('id',b.conversation_id).single();if(e||!conversation?.customer_id)throw new Error('403:Choose an authorized customer conversation.');
  const table=b.kind==='task'?'crm_tasks':'crm_memories';
  if(b.kind==='task'&&(!b.due_at||!Number.isFinite(Date.parse(b.due_at))))throw new Error('400:Choose a valid due date.');
  const row:Record<string,unknown>={workspace_id:conversation.workspace_id,customer_id:conversation.customer_id,action_key:b.action_key,...(b.kind==='task'?{title:b.content.trim(),due_at:new Date(b.due_at).toISOString()}:{content:b.content.trim(),source:'Proposed from Veltra Chat',status:'proposed'})};
  const {error:writeError}=await client.from(table).upsert(row,{onConflict:'workspace_id,action_key',ignoreDuplicates:true});if(writeError)throw writeError;
  const {data:receipt,error:readError}=await client.from(table).select('id').eq('workspace_id',conversation.workspace_id).eq('action_key',b.action_key).single();if(readError)throw readError;return ok({receipt_id:receipt.id,kind:b.kind,status:b.kind==='task'?'saved':'proposed'});
 }
 if(path[0]==='workspaces'&&path.length===1&&method==='GET'){const {data,error}=await client.from('crm_workspaces').select('id,name,industry');if(error)throw error;return ok({workspaces:data});}
 if(path[0]==='customers'&&path.length===1&&method==='GET'){
  const w=url.searchParams.get('workspace');if(!uuid(w))throw new Error('400:Choose a workspace.');
  const {data,error}=await client.from('crm_customers').select('id,company').eq('workspace_id',w).order('company').limit(500);if(error)throw error;return ok({customers:data});
 }
 if(path[0]==='context'&&path.length===2&&uuid(path[1])&&method==='GET')return ok(await crmContext(request,path[1]));
 if(path[0]==='memories'&&path.length<=2){
  if(method==='GET'){const {data,error}=await client.from('crm_personal_memories').select('*').order('created_at',{ascending:false}).limit(100);if(error)throw error;return ok({memories:data});}
  if(method==='POST'&&path.length===1){const b=await body();if(typeof b.content!=='string'||!b.content.trim()||b.content.length>2000)throw new Error('400:Enter a memory of up to 2,000 characters.');const {data,error}=await client.from('crm_personal_memories').insert({user_id:user.id,content:b.content.trim(),source:'Saved by you'}).select('id').single();if(error)throw error;return ok(data);}
  if(method==='DELETE'&&uuid(path[1])){const {data,error}=await client.from('crm_personal_memories').delete().eq('id',path[1]).select('id');if(error)throw error;if(!data?.length)throw new Error('404:Memory not found.');return ok({deleted:true});}
 }
 if(path[0]==='conversations'){
  if(path.length===1&&method==='GET'){
   const w=url.searchParams.get('workspace'),c=url.searchParams.get('customer');
   let q=client.from('crm_conversations').select('id,title,revision,workspace_id,customer_id,updated_at').neq('title','CRM bulk import review').neq('title','CRM action review').neq('title','Shared brain review').neq('title','Mail tool review').order('updated_at',{ascending:false}).limit(50);
   q=w?q.eq('workspace_id',w):q.is('workspace_id',null);q=c?q.eq('customer_id',c):q.is('customer_id',null);
   const {data,error}=await q;if(error)throw error;return ok({conversations:data});
  }
  if(path.length===1&&method==='POST'){
   const b=await body();if((b.workspace_id&&!uuid(b.workspace_id))||(b.customer_id&&(!uuid(b.customer_id)||!b.workspace_id)))throw new Error('400:Invalid customer workspace.');
   const {data,error}=await client.from('crm_conversations').insert({user_id:user.id,workspace_id:b.workspace_id||null,customer_id:b.customer_id||null}).select('*').single();if(error)throw error;return ok(data);
  }
  if(path.length===2&&uuid(path[1])){
   if(method==='GET'){const {data,error}=await client.from('crm_conversations').select('*').eq('id',path[1]).single();if(error)throw new Error('404:Conversation not found.');return ok(data);}
   if(method==='PUT'){const b=await body();if(!Number.isInteger(b.revision)||b.revision<0)throw new Error('400:Invalid conversation version.');const messages=checkedMessages(b.messages);const title=(messages.find(m=>m.role==='user')?.content||'New conversation').slice(0,160);
    const {data,error}=await client.from('crm_conversations').update({messages,title,revision:b.revision+1,updated_at:new Date().toISOString()}).eq('id',path[1]).eq('revision',b.revision).select('id,revision').maybeSingle();if(error)throw error;if(!data)throw new Error('409:Conversation changed elsewhere. Reload it before saving.');return ok(data);
   }
   if(method==='DELETE'){const {data,error}=await client.from('crm_conversations').delete().eq('id',path[1]).select('id');if(error)throw error;if(!data?.length)throw new Error('404:Conversation not found.');return ok({deleted:true});}
  }
 }
 throw new Error('404:Route not found.');
}catch(e){return crmError(e);}}
export const GET=handle;export const POST=handle;export const PUT=handle;export const DELETE=handle;

