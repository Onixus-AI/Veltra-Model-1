import {crmUser,crmError} from '@/lib/crm/server';
import {uuid,noStore} from '@/lib/revenue/server';
import {businessPeriod,type BusinessPeriod} from '@/lib/business-period';
export async function GET(request:Request){try{
 const url=new URL(request.url),workspace=url.searchParams.get('workspace'),period=url.searchParams.get('period')??'month';if(!uuid(workspace)||!['today','week','month'].includes(period))throw Error('400:Choose a business and reporting period.');
 const {client,user}=await crmUser(request);const member=await client.from('crm_memberships').select('role').eq('workspace_id',workspace).eq('user_id',user.id).maybeSingle();if(member.error||!member.data)throw Error('403:Business membership required.');
 const settings=await client.from('workspace_report_settings').select('time_zone').eq('workspace_id',workspace).maybeSingle();const range=businessPeriod(period as BusinessPeriod,settings.data?.time_zone||'UTC');
 const [overview,priorities,completed,previousCompleted,tasks,jobs,team,reports,trend]=await Promise.all([
 client.rpc('revenue_overview',{p_workspace:workspace,p_from:range.from,p_to:range.to}),client.rpc('revenue_priorities',{p_workspace:workspace,p_limit:4}),
 client.from('revenue_jobs').select('id',{count:'exact',head:true}).eq('workspace_id',workspace).eq('status','succeeded').or('workflow_key.is.null,workflow_key.neq.owner_daily_report').gte('finished_at',range.from).lt('finished_at',range.to),
 client.rpc('revenue_overview',{p_workspace:workspace,p_from:range.previousFrom,p_to:range.previousTo}),
 client.from('crm_tasks').select('id,title,due_at,status').eq('workspace_id',workspace).eq('status','open').order('due_at',{ascending:true}).limit(5),
 client.from('revenue_jobs').select('id,kind,status,run_at,last_error').eq('workspace_id',workspace).in('status',['queued','running','dead']).order('run_at',{ascending:true}).limit(5),
 client.from('workspace_team_jobs').select('id,status,updated_at,receipts').eq('workspace_id',workspace).order('updated_at',{ascending:false}).limit(10),
 client.from('workspace_daily_reports').select('id,report_day').eq('workspace_id',workspace).order('period_end',{ascending:false}).limit(1),client.rpc('workspace_business_trend',{p_workspace:workspace,p_from:range.from,p_to:range.to,p_bins:period==='today'?8:period==='week'?7:15})]);
 if(overview.error||priorities.error)throw Error('503:Business summary is unavailable. Refresh to retry.');
 return Response.json({workspace,period,range,trend:trend.error?null:trend.data,overview:overview.data,previous:previousCompleted.error?null:previousCompleted.data,priorities:priorities.data,completed:completed.error?null:completed.count,tasks:tasks.error?null:tasks.data,jobs:jobs.error?null:jobs.data,team:team.error?null:team.data,reports:reports.error?null:reports.data},{headers:noStore});
}catch(e){return crmError(e);}}
