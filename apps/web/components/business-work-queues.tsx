'use client';
import {useEffect,useState} from 'react';
import {gatewayAuthorizationHeaders} from '@/lib/client-session';
type Queues={overdue:number|null;mail:number|null;signal:number|null;failed:number|null;at:string};
export default function BusinessWorkQueues({workspace}:{workspace:string}){
 const [data,setData]=useState<Queues|null>(null);
 useEffect(()=>{if(!workspace)return;let live=true,inFlight=false;const controller=new AbortController();
 const load=async()=>{if(inFlight)return;inFlight=true;try{const headers=await gatewayAuthorizationHeaders();const read=async(path:string)=>{const response=await fetch(path,{headers,cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});if(!response.ok)throw Error();return response.json();};const [business,creative]=await Promise.allSettled([read('/api/workspace/overview?workspace='+encodeURIComponent(workspace)),read('/api/workspace/signal/overview?workspace='+encodeURIComponent(workspace))]);
 const metrics=business.status==='fulfilled'&&business.value.workspace===workspace?business.value.overview?.metrics:null;
 const signal=creative.status==='fulfilled'&&creative.value.workspace===workspace&&Array.isArray(creative.value.items)?creative.value.items:null;
 if(live)setData({overdue:typeof metrics?.commitments?.overdue==='number'?metrics.commitments.overdue:null,mail:typeof metrics?.outreach?.awaiting_approval==='number'?metrics.outreach.awaiting_approval:null,failed:typeof metrics?.failures?.dead_jobs==='number'&&typeof metrics?.failures?.failed_sends==='number'?metrics.failures.dead_jobs+metrics.failures.failed_sends:null,signal:signal?signal.filter((item:{status:string})=>['draft','drafted','in_review','awaiting_review'].includes(item.status)).length:null,at:new Date().toISOString()});
 }catch{if(live)setData({overdue:null,mail:null,signal:null,failed:null,at:new Date().toISOString()});}finally{inFlight=false;}};void load();const timer=setInterval(()=>{if(!document.hidden)void load();},20000);return()=>{live=false;controller.abort();clearInterval(timer);};},[workspace]);
 const w=encodeURIComponent(workspace);const rows=[{label:'Overdue commitments',value:data?.overdue,href:'/revenue?view=overview&w='+w},{label:'Mail awaiting review',value:data?.mail,href:'/revenue?view=mail&w='+w},{label:'Signal drafts in recent 30 assets',value:data?.signal,href:'/?canvas=signal&mode=business&crm_workspace='+w},{label:'Failed sends and dead jobs',value:data?.failed,href:'/revenue?view=automation&w='+w}];
 return <section className="team-source-queues" aria-label="Source work needing attention"><h2>Needs attention</h2><div>{rows.map(row=><a href={row.href} key={row.label}><span>{row.label}</span><strong>{row.value==null?(data?'Unavailable':'Checking…'):row.value}</strong></a>)}</div><p>Source queues are separate from worker jobs. {data?'Checked '+new Date(data.at).toLocaleTimeString():''}</p></section>;
}
