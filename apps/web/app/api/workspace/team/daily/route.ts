import {createClient} from '@supabase/supabase-js';
import {requireBearer} from '@/lib/revenue/ingest';
import {noStore} from '@/lib/revenue/server';
import {teamRuntime} from '@/lib/business-team/catalog';
import {planningSnapshot,executePilot} from '@/lib/business-team/pilot';
export const maxDuration=60;
export async function GET(request:Request){
 try{requireBearer(request,process.env.CRON_SECRET);}catch{return Response.json({error:'Unauthorized'},{status:401,headers:noStore});}
 if(teamRuntime().hermes!=='configured')return Response.json({status:'not_connected',started:0},{headers:noStore});
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)return Response.json({error:'Receipt storage unavailable'},{status:503,headers:noStore});
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 // One business per invocation bounds duration. A date claim prevents repeated model charges.
 const today=new Date().toISOString().slice(0,10);
 const due=await db.from('workspace_team_schedule').select('workspace_id').eq('enabled',true).or('last_day.is.null,last_day.lt.'+today).order('last_day',{ascending:true,nullsFirst:true}).limit(1);
 if(due.error)return Response.json({error:'Schedule storage unavailable'},{status:503,headers:noStore});
 const workspace=due.data?.[0]?.workspace_id;if(!workspace)return Response.json({started:0},{headers:noStore});
 const start=await db.rpc('workspace_team_daily_start',{p_workspace:workspace});
 if(start.error)return Response.json({error:'Daily claim failed'},{status:503,headers:noStore});
 const job=start.data;if(!job)return Response.json({started:0},{headers:noStore});
 try{
 const checkedAt=new Date().toISOString();
 const [dead,overdue,pending,failed,business]=await Promise.all([
 db.from('revenue_jobs').select('id',{head:true,count:'exact'}).eq('workspace_id',workspace).eq('status','dead'),
 db.from('crm_tasks').select('id',{head:true,count:'exact'}).eq('workspace_id',workspace).eq('status','open').lt('due_at',checkedAt),
 db.from('revenue_messages').select('id',{head:true,count:'exact'}).eq('workspace_id',workspace).eq('status','drafted'),
 db.from('revenue_messages').select('id',{head:true,count:'exact'}).eq('workspace_id',workspace).eq('status','failed'),
 db.from('crm_workspaces').select('industry').eq('id',workspace).single()]);
 if(dead.error||overdue.error||pending.error||failed.error||business.error||[dead.count,overdue.count,pending.count,failed.count].some(value=>value===null))throw Error('Context unavailable');
 const metrics={failures:{dead_jobs:dead.count,failed_sends:failed.count},commitments:{overdue:overdue.count},outreach:{awaiting_approval:pending.count}};
 const priorities=[...(overdue.count? [{kind:'overdue'}]:[]),...((dead.count||failed.count)?[{kind:'failed'}]:[]),...(pending.count?[{kind:'approval'}]:[])];
 const snapshot=planningSnapshot(business.data.industry||'Business services',{generated_at:checkedAt,metrics},priorities);
 const result=await executePilot(job.id,snapshot),at=new Date().toISOString();
 const receipts=[{member:'onyx',action:'Checked daily business queues',status:'completed',at:snapshot.checked_at,source:'revenue_jobs,crm_tasks,revenue_messages',detail:'Exact scoped counts of overdue commitments, Mail drafts, failed sends and dead jobs. Other connectors are not audited by this run.'},{member:'onixelia',action:'Prepared daily improvement proposals',status:'completed',at,engine:result.engine,model:result.model,version:result.version,usage:result.usage},{member:'onixa',action:'Reviewed daily improvement proposals',status:'completed',at,...result.review,detail:'Review only. Proposed work requires its own execution receipt.'}];
 const saved=await db.from('workspace_team_jobs').update({status:'completed',plan:result.tasks,receipts,finished_at:at}).eq('workspace_id',workspace).eq('id',job.id).eq('status','running');if(saved.error)throw Error('Receipt save failed');
 return Response.json({started:1,status:'completed',job_id:job.id},{headers:noStore});
 }catch{await db.from('workspace_team_jobs').update({status:'failed',failure:'Daily review failed. No external actions authorized.',finished_at:new Date().toISOString()}).eq('workspace_id',workspace).eq('id',job.id).eq('status','running');return Response.json({started:1,status:'failed',job_id:job.id},{headers:noStore});}
}
