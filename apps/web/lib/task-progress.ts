export type StepState='running'|'permission'|'review'|'completed'|'failed'|'skipped';
export type TaskStep={id:string;title:string;app:string;state:StepState;detail?:string};
export type TaskRun={id:string;purpose:string;state:'running'|'permission'|'review'|'completed'|'failed'|'cancelled';steps:TaskStep[];note?:string};
export type TaskEvent={type:'step';id:string;title:string;app:string}|{type:'result';id:string;state:'completed'|'failed'|'skipped';detail:string}|{type:'review';id:string;detail:string}|{type:'permission';app:string;reason:string}|{type:'resume'}|{type:'finish'}|{type:'fail';detail:string}|{type:'cancel'};
export type TaskObserver={event:(event:TaskEvent)=>void;cancelled:()=>boolean};
export function taskProgress(task:TaskRun,event:TaskEvent):TaskRun{
 if(event.type==='cancel')return {...task,state:'cancelled',steps:task.steps.map(s=>['running','permission','review'].includes(s.state)?{...s,state:'skipped' as const,detail:'Pending work stopped. An already-started request may still return a receipt.'}:s),note:'Pending work stopped. A request already in progress may still return a result.'};
 if(event.type==='result')return {...task,steps:task.steps.map(s=>s.id===event.id?{...s,state:event.state,detail:event.detail.slice(0,6000)}:s)};
 if(task.state==='cancelled')return task;
 if(event.type==='finish'&&task.state==='failed')return task;
 if(event.type==='step'){const found=task.steps.some(s=>s.id===event.id);return {...task,state:'running',steps:found?task.steps.map(s=>s.id===event.id?{...s,state:'running' as const}:s):[...task.steps,{id:event.id,title:event.title,app:event.app,state:'running' as const}].slice(-30)};}
 if(event.type==='review')return {...task,state:'review',steps:task.steps.map(s=>s.id===event.id?{...s,state:'review',detail:event.detail.slice(0,6000)}:s)};
 if(event.type==='permission')return {...task,state:'permission',steps:task.steps.map(s=>s.state==='running'?{...s,state:'permission' as const}:s),note:`${event.app}: ${event.reason}`};
 if(event.type==='resume')return {...task,state:'running',steps:task.steps.map(s=>s.state==='permission'?{...s,state:'running' as const}:s),note:undefined};
 if(event.type==='fail')return {...task,state:'failed',note:event.detail.slice(0,2000),steps:task.steps.map(s=>['running','review','permission'].includes(s.state)?{...s,state:'failed',detail:event.detail.slice(0,2000)}:s)};
 return {...task,state:task.steps.some(s=>s.state==='failed')?'failed':'completed',note:task.steps.some(s=>s.state==='failed')?'Some steps could not complete. Check the results before starting another request.':task.steps.some(s=>s.state==='skipped')?'Finished with skipped actions.':task.steps.length?'Results received. Review the receipts below.':'Response received. No tool-step receipts were reported for this request.'};
}
export function toolPresentation(name:string):{title:string;app:string}{
 const labels:Record<string,[string,string]>={veltra_capabilities:['Check available tools','Veltra'],crm_read:['Read CRM records','CRM'],crm_change:['Prepare CRM change','CRM'],brain_search:['Search shared memory','Shared brain'],brain_change:['Prepare memory change','Shared brain'],mail_search:['Search emails','Mail'],mail_read_thread:['Read email thread','Mail'],mail_find_followups:['Find unanswered quote candidates','Mail'],mail_prepare_followups:['Prepare follow-up drafts','Mail'],browser_inspect:['Inspect public page','Browser'],github_list_files:['Read repository files','GitHub'],github_read_file:['Read repository file','GitHub'],github_propose_commit:['Prepare repository change','GitHub'],vercel_list_deployments:['Check deployments','Vercel'],supabase_project:['Read project summary','Supabase'],railway_project:['Read project summary','Railway'],n8n_project:['Read workflow summary','n8n']};
 const [title,app]=labels[name]??['Run requested tool','Veltra'];return {title,app};
}
