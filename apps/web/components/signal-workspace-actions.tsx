'use client';
import {useEffect,useRef,useState,type RefObject} from 'react';
import {useRouter} from 'next/navigation';
import {gatewayAuthorizationHeaders} from '@/lib/client-session';
import {signalAction,signalBusinessClient,type SignalAction} from '@/lib/signal-actions';
const SIGNAL='https://www.onixus.xyz';
type Pending={action:SignalAction;review:any;source:Window;generation:number;workspace:string};
export default function SignalWorkspaceActions({frame,workspace,revision,onOpen}:{frame:RefObject<HTMLIFrameElement|null>;workspace:string;revision:number;onOpen?:(tool:'mail'|'calendar')=>void}){
 const router=useRouter(),[pending,setPending]=useState<Pending|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),processing=useRef(false),generation=useRef(0),opener=useRef(onOpen);opener.current=onOpen;
 async function call(path:string,method='GET',body?:unknown){const r=await fetch(path,{method,headers:{...await gatewayAuthorizationHeaders(),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,cache:'no-store',signal:AbortSignal.timeout(55000)});const d=await r.json();if(!r.ok)throw Error(d.error||'Workspace could not complete this request.');return d;}
 function reply(source:Window,action:SignalAction,ok:boolean,result?:unknown,error?:string){source.postMessage({type:'onixus.workspace.result',id:action.id,ok,result,error},SIGNAL);}
 useEffect(()=>{
  const current=++generation.current;processing.current=false;setPending(null);setBusy(false);setError('');
  const receive=async(event:MessageEvent)=>{
   if(event.origin!==SIGNAL||event.source!==frame.current?.contentWindow||!workspace)return;const action=signalAction(event.data);if(!action)return;const source=event.source as Window;
   if(processing.current){reply(source,action,false,undefined,'Finish or cancel the open Workspace review first.');return;}
   processing.current=true;setBusy(true);setError('');
   try{
    const links=await call('/api/workspace/signal');if(generation.current!==current)return;
    const link=links.connections?.find((x:any)=>x.workspace_id===workspace);
    if(!link||signalBusinessClient(workspace,link.signal_client_id)!==action.client)throw Error('Choose the Signal business linked to this Workspace before using its Mail or Google connections.');
    if(action.action==='open'){
     reply(source,action,true,{message:'Opening the connected Workspace tool.'});processing.current=false;setBusy(false);
     if(action.target==='mail'||action.target==='calendar'){if(opener.current)opener.current(action.target);else router.push('/?canvas='+action.target);}else router.push(action.target==='files'?'/workspace/files':'/settings/connections');return;
    }
    if(action.action==='calendar'){
     const status=await call('/api/google-calendar/status');if(generation.current!==current)return;
     if(!status.connected||status.workspace_id!==workspace)throw Error('Connect Google Calendar to this Workspace business first.');
     const start=new Date(action.scheduled_for),end=new Date(start.getTime()+15*60000),marker='Onixus Signal post: '+action.queue_id;
     const events=await call('/api/google-calendar/events?'+new URLSearchParams({calendar:'primary',from:new Date(start.getTime()-86400000).toISOString(),to:new Date(end.getTime()+86400000).toISOString()}));if(generation.current!==current)return;
     const existing=events.events?.find((e:any)=>e.description?.includes(marker));if(existing){reply(source,action,true,{message:'A Google Calendar reminder already exists for this post.',event:existing});processing.current=false;return;}
     const review=await call('/api/google-calendar/propose','POST',{action:'create',calendar_id:'primary',notify:false,draft:{title:action.title,description:action.description+'\n\n'+marker,location:'',all_day:false,start:start.toISOString().slice(0,16),end:end.toISOString().slice(0,16),time_zone:'UTC',attendees:[]}});
     if(generation.current===current)setPending({action,review,source,generation:current,workspace});return;
    }
    const review=action.action==='google'?await call('/api/google/propose','POST',{kind:action.kind,title:action.title,content:action.content}):await call('/api/workspace/signal/mail-signature?workspace='+encodeURIComponent(workspace)+'&client='+encodeURIComponent(action.client));
    if(generation.current===current)setPending({action,review,source,generation:current,workspace});
   }catch(e){if(generation.current===current){reply(source,action,false,undefined,e instanceof Error?e.message:'The connection is unavailable.');processing.current=false;}}
   finally{if(generation.current===current)setBusy(false);}
  };
  window.addEventListener('message',receive);return()=>{generation.current++;window.removeEventListener('message',receive);processing.current=false;};
 },[workspace,revision,frame,router]);
 async function confirm(){if(!pending||busy||pending.generation!==generation.current)return;const request=pending;setBusy(true);setError('');setPending(null);
  // One-use reviews: uncertain writes must be checked at the destination before another attempt.
  try{const {action,review}=request;const result=action.action==='calendar'?await call('/api/google-calendar/commit','POST',{ticket:review.ticket,confirmed:true,notify_confirmed:[]}):action.action==='google'?await call('/api/google/create','POST',{ticket:review.ticket,confirmed:true}):action.action==='signature'?await call('/api/workspace/signal/mail-signature','POST',{workspace:request.workspace,client:action.client,signature:action.signature,fingerprint:review.fingerprint,confirmed:true}):null;
   if(action.action==='google'&&!result?.file?.id)throw Error('Google did not return a created-file receipt.');
   if(action.action==='calendar'&&!result?.event?.id)throw Error('Google did not return a saved-event receipt.');
   if(request.generation===generation.current)reply(request.source,action,true,{...result,message:action.action==='calendar'?'Google Calendar reminder created. This does not publish or reschedule the Signal post.':action.action==='google'?'Created in your connected Google Drive.':result.message});
  }catch(e){if(request.generation===generation.current){const message=(e instanceof Error?e.message:'The save could not be verified.')+' Check the destination before reviewing another save.';setError(message);reply(request.source,request.action,false,undefined,message);}}
  finally{if(request.generation===generation.current){setBusy(false);processing.current=false;}}
 }
 function cancel(){if(!pending||busy)return;reply(pending.source,pending.action,false,undefined,'Cancelled without changing the connected app.');setPending(null);processing.current=false;}
 return <>{busy&&!pending&&<p role="status">Processing connected-app request…</p>}{error&&!pending&&<p role="alert">{error}</p>}{pending&&<div className="signal-action-backdrop"><section role="dialog" aria-modal="true" aria-label="Review Signal connected-app action" className="signal-action-review"><h2>{pending.action.action==='calendar'?'Add Google Calendar reminder?':pending.action.action==='google'?'Create '+pending.review.title:'Apply this Mail signature?'}</h2><p>{pending.action.action==='signature'?pending.review.email:pending.review.account?.email}</p>{pending.action.action==='signature'&&<><h3>Current signature</h3><pre>{pending.review.signature||'No signature saved'}</pre></>}<h3>{pending.action.action==='calendar'?'Event details':pending.action.action==='google'?'File content':'New signature'}</h3><pre>{pending.action.action==='google'?pending.action.content:pending.action.action==='signature'?pending.action.signature:pending.action.action==='calendar'?pending.action.title+'\n'+new Date(pending.action.scheduled_for).toLocaleString(undefined,{timeZoneName:'short'})+'\n'+pending.action.description:''}</pre><p>{pending.action.action==='calendar'?'Creates a 15-minute reminder on your primary calendar. No guests or notifications. Changes in either app do not sync automatically.':pending.action.action==='google'?"Creates a file using Google Drive’s default access settings. No sharing permissions are added.":'Updates the Mail business sign-off used for generated replies. No message is sent.'}</p><button disabled={busy} onClick={()=>void confirm()}>{pending.action.action==='calendar'?'Add reminder':pending.action.action==='google'?'Create this file':'Apply signature'}</button><button disabled={busy} onClick={cancel}>Cancel</button></section></div>}</>;
}
