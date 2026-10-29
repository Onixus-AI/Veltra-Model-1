import type {Operations} from './crm/operations';
export type SignalOverview={workspace:string;policy:{production_mode:string;autopublish?:{mode?:string}}|null;items:{id:string;platform:string;caption:string;status:string;created_at:string}[]|null;unavailable:string[];checked_at:string;limit:number};
export type WorkspaceAction={id:string;source:'CRM'|'Mail'|'Signal'|'Business OS';title:string;detail:string;at:string|null;receipt:string;href:string;snapshot:boolean};
export function workspaceActions(workspace:string,operations:Operations|null,signal:SignalOverview|null):WorkspaceAction[]{
 const crm=(view:string)=>'/crm?workspace='+encodeURIComponent(workspace)+'&view='+view;
 const rows:WorkspaceAction[]=(operations?.events??[]).map(e=>({id:'crm:'+e.id,source:'CRM',title:e.title,detail:e.kind.replaceAll('_',' '),at:e.created_at,receipt:'crm_activity:'+e.id,href:crm('Overview'),snapshot:false}));
 for(const s of operations?.sources??[])rows.push({id:'research:'+s.id,source:'CRM',title:s.label,detail:`${s.last_error?'Needs attention: '+s.last_error:!s.enabled?'Paused':s.exhausted_at?'Source complete':'Scheduled'} · ${s.imported} imported · ${s.enriched} enriched`,at:s.last_run_at,receipt:'crm_discovery_sources:'+s.id,href:crm('Sources'),snapshot:true});
 for(const m of operations?.outreach?.messages??[])rows.push({id:'mail:'+m.id,source:'Mail',title:m.subject||m.company,detail:`${m.company} · ${m.status==='sent'?'Provider accepted; inbox delivery not confirmed':m.status==='approved'?'Approved; not a send receipt':m.status}${m.last_error?' · '+m.last_error:''}`,at:null,receipt:'outreach_message:'+m.id,href:crm('Automation'),snapshot:true});
 if(signal?.workspace===workspace)for(const c of signal.items??[])rows.push({id:'signal:'+c.id,source:'Signal',title:`${c.platform} · ${c.status}`,detail:(c.caption||'Content recorded')+(c.status==='published'?' · Queue status only; open Signal for provider confirmation.':''),at:c.created_at,receipt:'signal_content_queue:'+c.id,href:'/?canvas=signal&mode=business&crm_workspace='+encodeURIComponent(workspace),snapshot:true});
 return rows.filter(r=>!r.at||Number.isFinite(Date.parse(r.at))).sort((a,b)=>(b.at?Date.parse(b.at):0)-(a.at?Date.parse(a.at):0));
}

export function groupWorkspaceActions(rows:WorkspaceAction[]){
 const groups=new Map<string,WorkspaceAction[]>();
 for(const r of rows){const key=!r.snapshot&&r.at?r.source+':'+r.title+':'+r.detail+':'+r.at.slice(0,16):r.id;const group=groups.get(key)||[];group.push(r);groups.set(key,group);}
 return [...groups].map(([id,events])=>({id,events}));
}
export type BusinessJob={id:string;kind:string;status:string;attempts:number;run_at:string;updated_at:string;last_error:string|null;cancel_reason:string|null};
export function businessJobActions(workspace:string,jobs:BusinessJob[]):WorkspaceAction[]{return jobs.filter(j=>Number.isFinite(Date.parse(j.updated_at))).map(j=>({id:'workflow:'+j.id,source:'Business OS',title:j.kind.replaceAll('_',' ')+' · '+j.status,detail:`Attempt ${j.attempts} · Scheduled ${j.run_at}${j.last_error?' · '+j.last_error:''}${j.cancel_reason?' · '+j.cancel_reason:''}`,at:j.updated_at,receipt:'revenue_jobs:'+j.id,href:'/revenue?w='+encodeURIComponent(workspace)+'&view=automation&job='+encodeURIComponent(j.id),snapshot:true}));}

export type BusinessToolEvent={id:string;tool:string;status:string;created_at:string};
export function businessToolActions(workspace:string,events:BusinessToolEvent[]):WorkspaceAction[]{return events.filter(e=>Number.isFinite(Date.parse(e.created_at))).map(e=>({id:'tool:'+e.id,source:'Business OS',title:e.tool.replaceAll('_',' ')+' · '+e.status,detail:e.status==='completed'?'A reviewed host action returned a completion receipt.':e.status==='review'?'An exact-action review was prepared; the action was not yet applied.':e.status==='failed'?'The host tool did not complete. Check its source before retrying.':'The host received a tool response. This is not proof of downstream delivery.',at:e.created_at,receipt:'workspace_business_events:'+e.id,href:'/?view=chat&mode=business&crm_workspace='+encodeURIComponent(workspace),snapshot:false}));}
