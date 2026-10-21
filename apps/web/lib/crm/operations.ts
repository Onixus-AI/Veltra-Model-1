export type ResearchSource = {id:string;label:string;enabled:boolean;imported:number;enriched:number;last_error:string|null;last_run_at:string|null;next_run_at:string;exhausted_at:string|null};
export type OperationEvent = {id:string;title:string;kind:string;created_at:string};
export type DailyOutreach={day:string;time_zone:string;sent_today:number;approved_due:number;awaiting_review:number;awaiting_receipt:number;needs_attention:number};
export type OutreachState = {daily?:DailyOutreach;campaigns:{id:string;name:string;status:string}[];messages:{id:string;company:string;subject:string;status:string;due_at:string;last_error:string|null}[]};
export type Operations = {sources:ResearchSource[]|null;events:OperationEvent[]|null;customers:number|null;openTasks:number|null;proposals:number|null;outreach:OutreachState|null;checkedAt:string;unavailable:string[]};
export type OperationAlert = {id:string;title:string;detail:string;destination:'Sources'|'Automation'|'Memory'|'Customers'};
export function operationAlerts(data:Operations):OperationAlert[]{
 const alerts:OperationAlert[]=[];
 for(const source of data.sources??[])if(source.last_error)alerts.push({id:`source:${source.id}:${source.last_error}`,title:`Research needs attention: ${source.label}`,detail:source.last_error,destination:'Sources'});
 for(const message of data.outreach?.messages??[])if(['blocked','uncertain'].includes(message.status))alerts.push({id:`message:${message.id}:${message.status}`,title:`Review outreach for ${message.company}`,detail:message.last_error||'Delivery needs review before the next attempt.',destination:'Automation'});
 const drafts=data.outreach?.messages.filter(m=>m.status==='draft').length??0;
 if(drafts)alerts.push({id:`drafts:${drafts}`,title:`${drafts} messages await approval`,detail:'Review the exact messages before enabling delivery.',destination:'Automation'});
 // This is the customer memory review queue, not personal or cross-business memory.
 if(data.proposals)alerts.push({id:`memory:${data.proposals}`,title:`${data.proposals} customer memories need review`,detail:'Check the source before adding these facts to customer context.',destination:'Memory'});
 return alerts;
}
export function researchState(source:ResearchSource){return source.last_error?'Needs attention':!source.enabled?'Paused':source.exhausted_at?'Source complete':'Scheduled';}
