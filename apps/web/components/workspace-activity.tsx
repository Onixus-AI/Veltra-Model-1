'use client';
import {useEffect,useMemo,useState} from 'react';
import {operationAlerts,type Operations} from '@/lib/crm/operations';
import {gatewayAuthorizationHeaders} from '@/lib/client-session';
import {workspaceActions,type SignalOverview} from '@/lib/workspace-activity';
import {mailHealthSummary,type MailHealth} from '@/lib/mail-health';
export default function WorkspaceActivity(props:{workspace:string;operations:Operations|null;mail:MailHealth|null;onMore:()=>void;limit:number}){
 return <ActivityView key={props.workspace} {...props}/>;
}
function ActivityView({workspace,operations,mail,onMore,limit}:{workspace:string;operations:Operations|null;mail:MailHealth|null;onMore:()=>void;limit:number}){
 const [signal,setSignal]=useState<SignalOverview|null>(null),[error,setError]=useState(''),[source,setSource]=useState('All'),[query,setQuery]=useState(''),[refresh,setRefresh]=useState(0),[loading,setLoading]=useState(true);
 useEffect(()=>{let active=true,inFlight=false;const controller=new AbortController();
 async function load(){if(inFlight||document.hidden)return;inFlight=true;setLoading(true);
 try{const headers=await gatewayAuthorizationHeaders();const response=await fetch('/api/workspace/signal/overview?workspace='+encodeURIComponent(workspace),{headers,cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(45000)])});if(!response.ok)throw Error('Signal unavailable');const data:SignalOverview=await response.json();if(data.workspace!==workspace)throw Error('Scope mismatch');if(active){setSignal(data);setError('');}}
 catch{if(active){setSignal(null);setError('Signal activity is unavailable. Check this business’s Signal connection.');}}finally{inFlight=false;if(active)setLoading(false);}}
 void load();const timer=setInterval(()=>void load(),60000);return()=>{active=false;controller.abort();clearInterval(timer);};},[workspace,refresh]);
 const rows=useMemo(()=>workspaceActions(workspace,operations,signal).filter(r=>(source==='All'||r.source===source)&&`${r.title} ${r.detail} ${r.receipt}`.toLowerCase().includes(query.toLowerCase())),[workspace,operations,signal,source,query]);
 const policy=signal?.policy;
 const alerts=operations?operationAlerts(operations):[];
 return <section className="workspace-activity" aria-labelledby="workspace-activity-title"><header><div><span className="suite-eyebrow">AUTOPILOT · BEHIND THE SCENES</span><h2 id="workspace-activity-title">See the work happening.</h2><p>Recorded actions and current work for this business. Expand an item to see its receipt.</p></div><button disabled={loading} onClick={()=>setRefresh(v=>v+1)}>{loading?'Checking Signal…':'Refresh Signal'}</button></header>
 <div className="workspace-policy"><div><b>Signal</b><span>{policy?`Production: ${policy.production_mode} · ${policy.autopublish?.mode==='autopilot'?'Autopilot eligible':'Review required'}`:loading?'Checking policy…':'Policy not verified'}</span></div><div><b>Mail · signed-in account</b><span>{mailHealthSummary(mail).label}</span></div><a href={'/?canvas=signal&mode=business&crm_workspace='+encodeURIComponent(workspace)}>Open Signal controls →</a></div>
 {(error||signal?.unavailable.length)?<p role="status" className="suite-error">{error||'Could not check: '+signal?.unavailable.join(', ')} Missing activity is unavailable, not zero.</p>:null}
 {alerts.length>0&&<aside className="workspace-review" aria-label="Needs your review"><h3>Needs your review</h3>{alerts.slice(0,8).map(a=><a key={a.id} href={'/crm?workspace='+encodeURIComponent(workspace)+'&view='+a.destination}><b>{a.title}</b><span>{a.detail}</span></a>)}</aside>}
 <div className="workspace-feed-filters"><label>Source<select value={source} onChange={e=>setSource(e.target.value)}>{['All','CRM','Mail','Signal'].map(s=><option key={s}>{s}</option>)}</select></label><label>Find work<input type="search" placeholder="Campaign, planning, handoff, receipt…" value={query} onChange={e=>setQuery(e.target.value)}/></label></div>
 <div className="workspace-feed" aria-busy={!operations}>{rows.map(r=><details key={r.id}><summary><span className={'workspace-source source-'+r.source.toLowerCase()}>{r.source}</span><strong>{r.title}</strong><small>{r.snapshot?'Current record':'Recorded action'}{r.at?' · '+new Date(r.at).toLocaleString():''}</small></summary><p>{r.detail}</p><code>{r.receipt}</code><a href={r.href}>Open this business’s source →</a></details>)}{!rows.length&&<p>{!operations?'CRM activity is loading or unavailable.':'No matching records in the loaded history.'}</p>}</div>
 <footer><p>Latest {limit} CRM events, up to 100 research sources, 500 outreach messages and 30 stored Signal assets. Content and message entries show current states, not a reconstructed history. Planning, jobs and agent handoffs appear only if recorded in these sources. Scheduled does not mean running; approval does not mean publication.</p><button disabled={limit>=1000} onClick={onMore}>{limit>=1000?'1,000 CRM events loaded':'Load more CRM history'}</button></footer>
 </section>;
}
