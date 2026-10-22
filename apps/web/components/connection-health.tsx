'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Activity,Mail,Users,RefreshCw} from 'lucide-react';
import {gatewayAuthorizationHeaders} from '@/lib/client-session';
import {connectionHealth,type HealthApp,type ConnectionHealth as Health} from '@/lib/connection-health';
export type HealthRequest=(app:HealthApp,signal:AbortSignal)=>Promise<{status:number;data:unknown}>;
const requestHealth:HealthRequest=async(app,signal)=>{
 const headers=await gatewayAuthorizationHeaders();if(!new Headers(headers).has('authorization'))return {status:401,data:null};
 const response=await fetch(app==='crm'?'/api/crm/connection':'/api/mail/link',{headers,cache:'no-store',signal:AbortSignal.any([signal,AbortSignal.timeout(12000)])});
 let data:unknown=null;try{data=await response.json();}catch{}return {status:response.status,data};
};
function HealthMotion({state,label}:{state:Health['state'];label:string}){
 return <svg className={'connection-health-motion '+state} viewBox="0 0 160 40" role="img" aria-label={label}>
  <path className="health-track" d="M24 20H136"/>
  <path className="health-signal" d="M24 20H136"/>
  <circle className="health-node" cx="15" cy="20" r="9"/><circle className="health-node" cx="145" cy="20" r="9"/>
  {state==='linked'?<path className="health-mark" d="m140 20 3 3 6-6"/>:state==='checking'?<circle className="health-ping" cx="145" cy="20" r="14"/>:<path className="health-mark" d="M141 20h8"/>}
 </svg>;
}
const checking:Health={state:'checking',label:'Checking…',detail:'Checking your current account connection.'};
export default function ConnectionHealth({request=requestHealth}:{request?:HealthRequest}){
 const [health,setHealth]=useState<Record<HealthApp,Health>>({crm:checking,mail:checking}),[checked,setChecked]=useState<string|null>(null),[busy,setBusy]=useState(false);
 const generation=useRef(0),active=useRef<AbortController|null>(null);
 const refresh=useCallback(async()=>{
  active.current?.abort();const controller=new AbortController();active.current=controller;const current=++generation.current;
  setBusy(true);setChecked(null);setHealth({crm:checking,mail:checking});
  await Promise.allSettled((['crm','mail'] as const).map(async app=>{
   let result:Health;try{const response=await request(app,controller.signal);result=connectionHealth(app,response.status,response.data);}catch{result=connectionHealth(app,0,null);}
   if(!controller.signal.aborted&&generation.current===current)setHealth(old=>({...old,[app]:result}));
  }));
  if(!controller.signal.aborted&&generation.current===current){setBusy(false);setChecked(new Date().toISOString());}
 },[request]);
 useEffect(()=>{void refresh();const update=()=>void refresh();window.addEventListener('veltra-connections-changed',update);return()=>{generation.current++;active.current?.abort();window.removeEventListener('veltra-connections-changed',update);};},[refresh]);
 return <section className="connection-health" aria-labelledby="connection-health-title" aria-busy={busy}>
  <header><div><Activity size={19}/><h2 id="connection-health-title">Connection health</h2></div><button type="button" disabled={busy} onClick={()=>void refresh()}><RefreshCw size={15}/>{busy?'Checking…':'Recheck connections'}</button></header>
  <p>Read-only checks for this account. No messages are sent and no connections are changed.</p>
  <div className="connection-health-rows" aria-live="polite">{(['crm','mail'] as const).map(app=>{const result=health[app],Icon=app==='crm'?Users:Mail;return <article key={app} aria-label={app==='crm'?'CRM connection health':'Mail connection health'}><Icon size={20}/><div><h3>Veltra {app==='crm'?'CRM':'Mail'}</h3><HealthMotion state={result.state} label={(app==='crm'?'CRM: ':'Mail: ')+result.label}/><span className={'connection-health-status '+result.state}>{result.label}</span><p>{result.detail}</p></div></article>;})}</div>
  <footer>{checked?<span>Last checked <time dateTime={checked}>{new Date(checked).toLocaleTimeString()}</time>. Recheck after changes.</span>:<span>Waiting for current checks.</span>}<span>These checks do not certify end-to-end readiness.</span></footer>
 </section>;
}
