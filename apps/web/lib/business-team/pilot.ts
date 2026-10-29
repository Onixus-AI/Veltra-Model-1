import {pilotLimits,validatePlan} from './catalog';
export type PlanningSnapshot={industry:string;checked_at:string;metrics:Record<string,unknown>;priorities:{kind:string;why:string;action:string}[]};
/** No recipient addresses, message bodies, files or connector credentials are handed to the runtime. */
export function planningSnapshot(industry:string,overview:unknown,priorities:unknown):PlanningSnapshot{
 const data=overview as {generated_at?:string;metrics?:Record<string,unknown>};
 if(!data||!data.metrics||!data.generated_at||!Number.isFinite(Date.parse(data.generated_at)))throw Error('503:Verified business figures are required.');
 const list=Array.isArray(priorities)?priorities.slice(0,8):[];
 // Priority text can contain contact information. The pilot uses typed categories and fixed actions only.
 const known:Record<string,string>={overdue:'Review overdue commitments',approval:'Review pending approvals',failed:'Investigate failed work',reply:'Review customer replies'};
 const numeric:Record<string,unknown>={};
 const allowed:Record<string,string[]>={leads:['total','discovery_imports'],outreach:['threads_sent','threads_replied','replies_received','awaiting_approval'],bookings:['scheduled','upcoming'],commitments:['overdue','due_today'],failures:['failed_sends','dead_jobs','sync_problems','paused']};
 for(const [section,fields] of Object.entries(allowed)){const raw=data.metrics[section] as Record<string,unknown>|undefined;numeric[section]=Object.fromEntries(fields.flatMap(key=>{const value=raw?.[key];return typeof value==='number'&&Number.isFinite(value)&&value>=0||typeof value==='boolean'?[[key,value]]:[];}));}
 return {industry:industry.slice(0,100),checked_at:data.generated_at,metrics:numeric,priorities:list.map(p=>{const candidate=String(p.kind??'');const kind=Object.hasOwn(known,candidate)?candidate:'other';return {kind,why:'A verified business priority requires attention.',action:known[kind]??'Review the source business priority'};})};
}
export async function executePilot(id:string,snapshot:PlanningSnapshot,transport:typeof fetch=fetch){
 const endpoint=process.env.ONIXELIA_URL,token=process.env.ONIXELIA_TOKEN;
 if(!endpoint||!token||token.length<32)throw Error('503:Onixelia is not connected. No job was executed.');
 const url=new URL(endpoint);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('503:Invalid Onixelia service configuration.');
 const body=JSON.stringify({job_id:id,scope:'internal_daily_plan',snapshot});if(new TextEncoder().encode(body).length>pilotLimits.maxSnapshotBytes)throw Error('503:Planning snapshot exceeds the pilot limit.');
 const response=await transport(new URL('/v1/plan',url),{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(pilotLimits.maxRunSeconds*1000)});
 if(!response.ok)throw Error('503:Onixelia could not complete the planning job.');
 const raw=await response.text();if(new TextEncoder().encode(raw).length>pilotLimits.maxOutputBytes)throw Error('503:Onixelia returned an oversized result.');
 const result=JSON.parse(raw);if(result.job_id!==id||result.engine!=='hermes'||typeof result.version!=='string'||!result.version||result.scope!=='internal_daily_plan')throw Error('503:Onixelia returned an invalid execution receipt.');
 const tasks=validatePlan(result);
 const sources=new Set(['business_metrics',...snapshot.priorities.map((_,i)=>'business_priority:'+i)]);
 if(tasks.some(task=>!sources.has(task.source)))throw Error('503:Plan cites an unavailable source.');
 const review=result.review;
 if(!review||review.engine!=='jev'||typeof review.model!=='string'||!/^typesafe\/jev-1\.14(?:-\d{8})?$/.test(review.model)||typeof review.score!=='number'||!Number.isFinite(review.score)||review.score<0||review.score>10||typeof review.confidence!=='number'||!Number.isFinite(review.confidence)||review.confidence<0||review.confidence>1||review.decision!=='review_only')throw Error('503:Decision support returned an invalid review receipt.');
 return {tasks,review:{engine:'jev',model:review.model,score:review.score,confidence:review.confidence,cost_usd:typeof review.cost_usd==='number'&&Number.isFinite(review.cost_usd)&&review.cost_usd>=0?review.cost_usd:null},engine:'hermes',version:result.version,model:typeof result.model==='string'?result.model.slice(0,100):null,usage:result.usage??null};
}
