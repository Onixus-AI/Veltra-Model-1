'use client';
import {useEffect,useRef,useState} from 'react';
import {Activity,ArrowRight,Brain,CheckCircle2,ChevronDown,Mail,Pause,Play,RefreshCw,Search,Users,X} from 'lucide-react';
import {db} from '@/lib/crm/client';
import {operationAlerts,researchState,type Operations,type ResearchSource,type OperationEvent,type OutreachState} from '@/lib/crm/operations';

type Destination='Sources'|'Automation'|'Memory'|'Customers';
type Props={workspace:string;preview?:boolean;compact?:boolean;currentTask?:string;onNavigate?:(destination:Destination)=>void};
const unknown='—';
const when=(value:string)=>new Date(value).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});

export default function OperationsCenter(props:Props){
 // A different business gets a fresh monitor, including its notification history.
 return <OperationsView key={`${props.workspace}:${!!props.preview}`} {...props}/>;
}
function OperationsView({workspace,preview=false,compact=false,currentTask='',onNavigate}:Props){
 const [state,setState]=useState<Operations|null>(null),[paused,setPaused]=useState(false),[refresh,setRefresh]=useState(0),[loading,setLoading]=useState(false),[error,setError]=useState(''),[toast,setToast]=useState<{title:string;detail:string}|null>(null),[expanded,setExpanded]=useState(false);
 const seen=useRef<Set<string>|null>(null);
 useEffect(()=>{
  if(preview||!workspace||!db)return;
  const client=db;
  let disposed=false,inFlight=false,timer:ReturnType<typeof setTimeout>|undefined,controller:AbortController|undefined;
  async function load(){
   if(disposed||inFlight||document.hidden||paused)return;
   inFlight=true;setLoading(true);controller=new AbortController();
   const signal=controller.signal,timeout=setTimeout(()=>controller?.abort(),15000);
   try{
    const {data:auth}=await client.auth.getSession();
    if(!auth.session)throw new Error('Sign in to see your business activity.');
    const checks=await Promise.allSettled([
     client.from('crm_discovery_sources').select('id,label,enabled,imported,enriched,last_error,last_run_at,next_run_at,exhausted_at').eq('workspace_id',workspace).order('created_at',{ascending:false}).limit(100).abortSignal(signal),
     client.from('crm_activity').select('id,title,kind,created_at').eq('workspace_id',workspace).order('created_at',{ascending:false}).order('id').limit(20).abortSignal(signal),
     client.from('crm_customers').select('id',{count:'exact',head:true}).eq('workspace_id',workspace).abortSignal(signal),
     client.from('crm_tasks').select('id',{count:'exact',head:true}).eq('workspace_id',workspace).eq('status','open').abortSignal(signal),
     client.from('crm_memories').select('id',{count:'exact',head:true}).eq('workspace_id',workspace).eq('status','proposed').abortSignal(signal),
     fetch('/api/crm/outreach?workspace='+encodeURIComponent(workspace),{headers:{Authorization:`Bearer ${auth.session.access_token}`},cache:'no-store',signal}).then(async response=>{if(!response.ok)throw new Error('Outreach unavailable');return response.json() as Promise<OutreachState>;})
    ]);
    if(disposed)return;
    if(signal.aborted)throw new Error("Activity check timed out");
    const unavailable:string[]=[];
    function rows<T>(index:number,label:string):T|null{const result=checks[index];if(result.status==='rejected'||(result.value as {error?:unknown}).error){unavailable.push(label);return null;}return (result.value as unknown as {data:T}).data;}
    function count(index:number,label:string){const result=checks[index];if(result.status==='rejected'||(result.value as {error?:unknown}).error){unavailable.push(label);return null;}return (result.value as {count:number|null}).count;}
    const outreach=checks[5];
    const next:Operations={sources:rows<ResearchSource[]>(0,'Research'),events:rows<OperationEvent[]>(1,'Activity'),customers:count(2,'Customers'),openTasks:count(3,'Tasks'),proposals:count(4,'Memory'),outreach:outreach.status==='fulfilled'?outreach.value as OutreachState:null,checkedAt:new Date().toISOString(),unavailable};
    if(!next.outreach)unavailable.push('Outreach');
    const alerts=operationAlerts(next),fresh=seen.current?alerts.find(a=>!seen.current!.has(a.id)):undefined;
    if(fresh)setToast({title:fresh.title,detail:fresh.detail});
    seen.current=new Set(alerts.map(a=>a.id));
    setState(next);setError('');
   }catch{if(!disposed){setState(null);setError('Live view unavailable. Check your sign-in or connection, then refresh.');}}
   finally{clearTimeout(timeout);inFlight=false;if(!disposed){setLoading(false);timer=setTimeout(()=>void load(),20000);}}
  }
  const visibility=()=>{if(!document.hidden){clearTimeout(timer);void load();}};
  const {data:subscription}=client.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT'||event==='SIGNED_IN'){controller?.abort();setState(null);setToast(null);seen.current=null;setError(event==='SIGNED_OUT'?'Sign in to see your business activity.':'Checking your account…');}});
  document.addEventListener('visibilitychange',visibility);void load();
  return()=>{disposed=true;clearTimeout(timer);controller?.abort();subscription.subscription.unsubscribe();document.removeEventListener('visibilitychange',visibility);};
 },[workspace,preview,paused,refresh]);
 const open=!compact||expanded;
 const alerts=state?operationAlerts(state):[],sources=state?.sources,mail=state?.outreach;
 const drafts=mail?.messages.filter(m=>m.status==='draft').length,queued=mail?.messages.filter(m=>m.status==='approved').length,sent=mail?.messages.filter(m=>m.status==='sent').length;
 const enabled=sources?.filter(s=>s.enabled&&!s.exhausted_at).length;
 function navigate(destination:Destination){if(onNavigate)onNavigate(destination);else window.location.assign('/?canvas=crm');}
 return <section className={`veltra-ops ${compact?'veltra-ops-compact':''}`} aria-label="Business operations">
  <div className="ops-header"><div className="ops-title"><Activity size={19}/><div><h2>{compact?'Business activity':'Your business, in motion.'}</h2><p>{preview?'Preview layout · Connect your workspace for real activity.':!workspace?'Select a business in Chat or open CRM to see its work.':paused?'Live view paused. Automations keep their existing settings.':loading?'Checking work and receipts…':state?'Updates every 20 seconds while this view is visible.':'Connect to see what is happening.'}</p></div></div><div className="ops-controls"><span className={`ops-status ${loading?'is-checking':''}`}>{preview?'Preview':paused?'View paused':error||state?.unavailable.length?'Check connection':state?'Monitoring':'Waiting'}</span>{workspace&&!preview&&<><button type="button" aria-label={paused?'Resume live view':'Pause live view'} title={paused?'Resume live view':'Pause live view'} onClick={()=>setPaused(p=>!p)}>{paused?<Play size={15}/>:<Pause size={15}/>}</button><button type="button" aria-label="Refresh business activity" disabled={loading||paused} onClick={()=>setRefresh(n=>n+1)}><RefreshCw size={15}/></button></>}{compact&&alerts.length>0&&<span className="ops-review-count">{alerts.length} need you</span>}{compact&&<button type="button" aria-label={open?'Hide activity details':'Show activity details'} aria-expanded={open} onClick={()=>setExpanded(p=>!p)}><ChevronDown size={16}/></button>}</div></div>
  {currentTask&&<div className="ops-current" role="status"><span className="ops-pulse"/><strong>Chat is working</strong><span>{currentTask}</span></div>}
  {error&&<p className="ops-warning" role="status">{error}</p>}
  {state?.unavailable.length? <p className="ops-warning">Could not check: {state.unavailable.join(', ')}. Their figures are unavailable; refresh or check Connections.</p>:null}
  {open&&<><div className="ops-process" aria-label="Work by stage">
   <button type="button" className="ops-stage ops-cyan" onClick={()=>navigate('Sources')}><Search size={20}/><span>Research</span><strong>{enabled??unknown}<small> sources scheduled</small></strong><p>{sources?`${sources.reduce((n,s)=>n+s.imported,0)} imported · ${sources.reduce((n,s)=>n+s.enriched,0)} enriched`:'Connect sources to find and verify prospects.'}</p><ArrowRight size={16}/></button>
   <button type="button" className="ops-stage ops-lime" onClick={()=>navigate('Customers')}><Users size={20}/><span>Organize</span><strong>{state?.customers??unknown}<small> customer records</small></strong><p>{state?.openTasks===null||!state?'Track relationships and their next step.':`${state.openTasks} open actions with customer context.`}</p><ArrowRight size={16}/></button>
   <button type="button" className="ops-stage ops-magenta" onClick={()=>navigate('Memory')}><Brain size={20}/><span>Review</span><strong>{state?.proposals??unknown}<small> customer memories</small></strong><p>Check sources and approve facts for the next conversation.</p><ArrowRight size={16}/></button>
   <button type="button" className="ops-stage ops-lemon" onClick={()=>navigate('Automation')}><Mail size={20}/><span>Outreach</span><strong>{queued??unknown}<small> approved messages</small></strong><p>{mail?`${drafts} drafts · ${sent} provider accepted. ${mail.campaigns.filter(c=>c.status==='active').length} active campaigns.`:'Connect Mail to see campaign progress.'}</p><ArrowRight size={16}/></button>
  </div><div className="ops-body"><div className="ops-stream"><div className="ops-section-heading"><h3>Work receipts</h3><span>{state?`Checked ${when(state.checkedAt)}`:'No live snapshot yet'}</span></div>{sources?.slice(0,4).map(source=><article className="ops-event" key={source.id}><Search size={16}/><div><strong>{source.label}</strong><p>{researchState(source)} · {source.imported} imported · {source.enriched} enriched</p><small>{source.last_run_at?`Last checked ${when(source.last_run_at)}`:'No completed check yet'}{source.enabled&&!source.exhausted_at?` · Eligible again ${when(source.next_run_at)}`:''}</small></div></article>)}{state?.events?.slice(0,6).map(event=><article className="ops-event" key={event.id}><CheckCircle2 size={16}/><div><strong>{event.title}</strong><p>{event.kind.replaceAll('_',' ')} · <time dateTime={event.created_at}>{when(event.created_at)}</time></p></div></article>)}{!state?.events?.length&&!sources?.length&&<div className="ops-empty"><Activity size={24}/><h3>Every action should leave a receipt.</h3><p>{preview?'This preview has no live connection.':'Customer changes and research results appear here as they are recorded.'}</p><button type="button" onClick={()=>navigate('Sources')}>View research sources</button></div>}<p className="ops-footnote">Latest 20 customer events and up to 100 research sources. Outreach figures cover the latest 500 messages. Scheduled does not mean currently running; provider acceptance does not confirm inbox delivery.</p></div><aside className="ops-attention"><h3>Needs you <span>{alerts.length}</span></h3>{alerts.slice(0,5).map(alert=><button type="button" className="ops-alert" key={alert.id} onClick={()=>navigate(alert.destination)}><strong>{alert.title}</strong><span>{alert.detail}</span><small>{`Open ${alert.destination.toLowerCase()}`}</small></button>)}{!alerts.length&&<p>{state&&!state.unavailable.length?'No review alerts in the checked queues.':'Review alerts will appear when their queues are available.'}</p>}<div className="ops-not-connected"><strong>More ways to work</strong><p>Posting and lead grading are not monitored here yet. Connect a verified workflow before showing them as active.</p></div></aside></div></>}
  <div className="ops-announcement" role="status" aria-live="polite">{toast&&<div className="ops-toast"><div><strong>{toast.title}</strong><p>{toast.detail}</p></div><button type="button" aria-label="Dismiss activity notification" onClick={()=>setToast(null)}><X size={16}/></button></div>}</div>
 </section>;
}
