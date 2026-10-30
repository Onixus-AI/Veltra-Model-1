import type {SupabaseClient} from '@supabase/supabase-js';
import {teamRuntime} from './catalog';
import {reviewedActionReceipt} from '../completion-evidence';
import type {ToolOutcome} from '../chat-tools';
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9-]{36}$/i.test(v);
const title='Business team schedule review';
export async function businessTeamAction(o:{client:SupabaseClient;user:string;workspace?:string;args:Record<string,unknown>;review?:string}):Promise<ToolOutcome>{
 const {client,user,args}=o;let workspace=o.workspace;
 if(!workspace){const owned=await client.from('crm_workspaces').select('id').eq('owner_id',user).limit(2);if(owned.error||owned.data?.length!==1)throw Error('400:Select the business conversation for this report or team schedule.');workspace=owned.data[0].id;}
 const member=await client.from('crm_memberships').select('role').eq('workspace_id',workspace).eq('user_id',user).maybeSingle();if(member.error||!member.data)throw Error('403:Business membership required.');
 const [report,team,jobs,reports]=await Promise.all([
  client.from('workspace_report_settings').select('enabled,time_zone,report_hour').eq('workspace_id',workspace).maybeSingle(),
  client.from('workspace_team_schedule').select('enabled,last_day').eq('workspace_id',workspace).maybeSingle(),
  client.from('workspace_team_jobs').select('id,status,created_at,finished_at,receipts,failure').eq('workspace_id',workspace).order('created_at',{ascending:false}).limit(3),
  client.from('workspace_daily_reports').select('id,report_day,time_zone,created_at,email_message_id,email_error').eq('workspace_id',workspace).order('report_day',{ascending:false}).limit(3)]);
 if([report,team,jobs,reports].some(r=>r.error))throw Error('503:Daily schedule or report receipts could not be verified.');
 const runtime=teamRuntime();
 if(!o.review&&args.action==='status')return {content:JSON.stringify({checked_at:new Date().toISOString(),workspace,scheduler:{available:true,engine:'Workspace cron; n8n is optional, not required'},report_settings:report.data,report_delivery:'Workspace and email to verified business owner',team_schedule:team.data??{enabled:false,last_day:null},runtime,team_jobs:jobs.data,reports:reports.data,policy:'A generated daily report is not proof of a meeting or completed team work. Team pilot prepares proposals, not autonomous external execution. Saved report settings are the current preferences; do not ask the owner to choose them again. Email queued/accepted is not delivery.'})};
 if(member.data.role!=='owner')throw Error('403:Only the owner can review schedule changes.');
 const validate=(raw:Record<string,unknown>)=>{
  if(!['propose_report','propose_team'].includes(String(raw.action))||typeof raw.enabled!=='boolean')throw Error('400:Choose the schedule and whether to enable it.');
  if(raw.action==='propose_team'){if(raw.enabled&&runtime.hermes!=='configured')throw Error('409:Onixelia/Hermes runtime is not connected. The Workspace scheduler exists, but the team planning worker must be connected before enabling daily planning. No n8n workflow is required.');return {action:'propose_team',enabled:raw.enabled};}
  const time_zone=raw.time_zone??report.data?.time_zone,hour=raw.hour??report.data?.report_hour;if(typeof time_zone!=='string'||!Number.isInteger(hour)||Number(hour)<0||Number(hour)>23)throw Error('400:Read saved preferences or ask for a report timezone and hour.');try{new Intl.DateTimeFormat('en',{timeZone:time_zone});}catch{throw Error('400:Choose a valid IANA timezone.');}return {action:'propose_report',enabled:raw.enabled,time_zone,hour:Number(hour)};
 };
 if(o.review){if(!uuid(o.review))throw Error('400:Invalid schedule review.');const r=await client.from('crm_conversations').select('workspace_id,revision,messages').eq('id',o.review).eq('user_id',user).eq('title',title).maybeSingle();if(r.error||!r.data||r.data.revision!==0||r.data.workspace_id!==workspace)throw Error('409:Schedule review was used or its business changed.');let saved;try{saved=JSON.parse(r.data.messages[0].content);}catch{throw Error('409:Invalid schedule review.');}if(saved.type!=='business_team_schedule'||!Number.isFinite(saved.expires_at)||saved.expires_at<=Date.now())throw Error('409:Schedule review expired.');const plan=validate(saved.plan);
  const claim=await client.from('crm_conversations').update({revision:1}).eq('id',o.review).eq('user_id',user).eq('revision',0).select('id').maybeSingle();if(claim.error||!claim.data)throw Error('409:Schedule review was already used.');
  const result=plan.action==='propose_team'?await client.rpc('workspace_team_schedule_set',{p_workspace:workspace,p_enabled:plan.enabled}):await client.rpc('workspace_report_settings_set',{p_workspace:workspace,p_enabled:plan.enabled,p_time_zone:plan.time_zone,p_hour:plan.hour});if(result.error)throw Error('503:Schedule change is unverified. Read status before retrying.');
  const source=plan.action==='propose_team'?'workspace_team_schedule':'workspace_report_settings',check=await client.from(source).select('*').eq('workspace_id',workspace).single();if(check.error||check.data.enabled!==plan.enabled||(plan.action==='propose_report'&&(check.data.time_zone!==plan.time_zone||check.data.report_hour!==plan.hour)))throw Error('503:Saved schedule could not be verified. Read status before retrying.');
  return {content:JSON.stringify(reviewedActionReceipt('crm',o.review,{kind:'result',changed:true,reply:'Reviewed schedule saved and read back. This does not claim a report was delivered, a meeting occurred, or business work executed.',details:{workspace,schedule:check.data}}))};
 }
 const plan=validate(args),id=crypto.randomUUID(),payload={type:'business_team_schedule',plan,expires_at:Date.now()+600000};const saved=await client.from('crm_conversations').insert({id,user_id:user,workspace_id:workspace,customer_id:null,title,messages:[{role:'system',content:JSON.stringify(payload)}],revision:0});if(saved.error)throw Error('503:Schedule review could not be saved.');return {content:'Schedule proposal saved; nothing changed.',proposal:{id,summary:JSON.stringify({workspace,...plan,delivery:plan.action==='propose_report'?'Workspace and verified owner email':'Internal daily planning proposals only; no external actions',note:'Requires approval. n8n is not required.'},null,2),agent_review:{target:'crm',id}}};
}
