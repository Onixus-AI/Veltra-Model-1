import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import {crmUser,crmError} from '@/lib/crm/server';
import {uuid,noStore,readJson} from '@/lib/revenue/server';
import {businessTeam,teamRuntime} from '@/lib/business-team/catalog';
import {responsibilitiesForIndustry} from '@/lib/business-team/responsibilities';
import {executePilot,planningSnapshot} from '@/lib/business-team/pilot';
export const maxDuration=60;
async function context(request:Request,workspace:unknown){
 if(!uuid(workspace))throw Error('400:Choose a business.');const {client,user}=await crmUser(request);
 const member=await client.from('crm_memberships').select('role').eq('workspace_id',workspace).eq('user_id',user.id).maybeSingle();
 if(member.error||!member.data)throw Error('403:Business membership required.');return {client,user,role:member.data.role,workspace};
}
export async function GET(request:Request){try{
 const {client,role,workspace}=await context(request,new URL(request.url).searchParams.get('workspace'));
 const result=await client.from('workspace_team_jobs').select('id,workspace_id,status,plan,receipts,failure,created_at,finished_at').eq('workspace_id',workspace).order('created_at',{ascending:false}).limit(20);
 if(result.error)throw Error('503:Team job storage is not ready.');
 const work=await client.from('revenue_jobs').select('id,kind,status,run_at,updated_at,finished_at,attempts,max_attempts,last_error,cancel_reason').eq('workspace_id',workspace).order('updated_at',{ascending:false}).limit(100);
 const attempts=work.data?.length?await client.from('revenue_job_runs').select('job_id,attempt,worker,started_at,finished_at,outcome,error').eq('workspace_id',workspace).in('job_id',work.data.map(j=>j.id)).order('started_at',{ascending:false}).limit(500):{data:[],error:null};
 const responsibilities=await client.from('workspace_team_responsibilities').select('task_key,owner,task_group,title,check_description,completion_evidence,tool,execution,assigned_at').eq('workspace_id',workspace);
 const schedule=await client.from('workspace_team_schedule').select('enabled,last_day').eq('workspace_id',workspace).maybeSingle();
 return Response.json({responsibilities:responsibilities.data??[],responsibilities_error:responsibilities.error?'Daily assignments are not available yet.':null,schedule:schedule.data??{enabled:false,last_day:null},schedule_error:schedule.error?'Daily schedule storage is not ready.':null,work:(work.data??[]).map(job=>({...job,runs:(attempts.data??[]).filter(run=>run.job_id===job.id)})),attempts_error:attempts.error?'Attempt receipts could not be loaded.':null,work_error:work.error?'Operational jobs could not be loaded.':null,checked_at:new Date().toISOString(),workspace,team:businessTeam,runtime:teamRuntime(),can_run:role==='owner',jobs:result.data},{headers:noStore});
 }catch(e){return crmError(e);}}
export async function POST(request:Request){let running:string|undefined;let server:SupabaseClient|undefined;
 try{
 const body=await readJson(request,2000),{client,user,role,workspace}=await context(request,body.workspace);
 if(body.action==='assign'){if(role!=='owner')throw Error('403:Business owner required.');const industry=await client.from('crm_workspaces').select('industry').eq('id',workspace).single();if(industry.error)throw Error('503:Business industry could not be checked.');const assigned=await client.rpc('workspace_team_assign_responsibilities',{p_workspace:workspace,p_tasks:responsibilitiesForIndustry(industry.data.industry||'')});if(assigned.error)throw Error('503:Daily responsibilities could not be assigned.');return Response.json({assigned:assigned.data},{headers:noStore});}
 if(body.action==='schedule'){if(role!=='owner')throw Error('403:Business owner required.');if(typeof body.enabled!=='boolean')throw Error('400:Choose enabled or paused.');if(body.enabled){const duties=await client.from('workspace_team_responsibilities').select('task_key').eq('workspace_id',workspace).limit(1);if(duties.error||!duties.data?.length)throw Error('409:Assign daily responsibilities first.');}if(body.enabled&&teamRuntime().hermes!=='configured')throw Error('503:Connect the worker before enabling daily reviews.');const changed=await client.rpc('workspace_team_schedule_set',{p_workspace:workspace,p_enabled:body.enabled});if(changed.error)throw Error('503:Schedule could not be saved.');return Response.json({enabled:body.enabled},{headers:noStore});}
 if(role!=='owner')throw Error('403:Only the business owner can run the pilot.');if(!uuid(body.request_key))throw Error('400:Request key required.');
 if(teamRuntime().hermes!=='configured')throw Error('503:Onixelia is not connected. No job was executed.');
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key)throw Error('503:Team receipt storage is not configured.');
 server=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const [overview,priorities,business]=await Promise.all([client.rpc('revenue_overview',{p_workspace:workspace,p_from:null,p_to:null}),client.rpc('revenue_priorities',{p_workspace:workspace,p_limit:8}),client.from('crm_workspaces').select('industry').eq('id',workspace).single()]);
 if(overview.error||priorities.error||business.error)throw Error('503:Business context could not be verified.');
 const snapshot=planningSnapshot(business.data.industry||'Business services',overview.data,priorities.data);
 const start=await client.rpc('workspace_team_start',{p_workspace:workspace,p_request:body.request_key});if(start.error)throw Error('409:The pilot could not start. Check for an active run or the three-run daily limit.');
 const job=start.data;if(!uuid(job?.id))throw Error('503:Invalid job receipt.');
 if(job.replayed)return Response.json({job,replayed:true},{headers:noStore});running=job.id;
 const result=await executePilot(job.id,snapshot);
 const at=new Date().toISOString();
 const receipts=[{member:'onyx',action:'Verified business snapshot',status:'completed',at:snapshot.checked_at,source:'revenue_overview'},
 {member:'onixelia',action:'Prepared an internal daily plan',status:'completed',at,engine:result.engine,version:result.version,model:result.model,usage:result.usage},
 {member:'onixa',action:'Evaluated the internal plan',status:'completed',at,...result.review,detail:'Quality score '+result.review.score.toFixed(1)+'/10. This is a review, not execution authorization.'},
 {member:'onyx',action:'Recorded proposed assignments',status:'completed',at,detail:'Assignments are proposals. No emails sent, posts published or calendar events changed.'}];
 const saved=await server.from('workspace_team_jobs').update({status:'completed',plan:result.tasks,receipts,finished_at:at}).eq('id',job.id).eq('workspace_id',workspace).eq('requested_by',user.id).eq('status','running').select('id,status,plan,receipts,created_at,finished_at').single();
 if(saved.error)throw Error('503:Execution finished but its receipt could not be saved. Check the job before retrying.');running=undefined;
 return Response.json({job:saved.data},{headers:noStore});
 }catch(e){if(running&&server)await server.from('workspace_team_jobs').update({status:'failed',failure:'Planning did not complete with a verified receipt. No external actions were authorized.',finished_at:new Date().toISOString()}).eq('id',running).eq('status','running');return crmError(e);}}
