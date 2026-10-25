"use client";
import {useEffect,useState} from 'react';
import Link from 'next/link';
import ToolLogo from './tool-logo';
import {gatewayAuthorizationHeaders} from '@/lib/client-session';
type Status={connected:boolean;tools:string[]};
async function call<T>(path:string,method='GET',body?:object):Promise<T>{
 const r=await fetch('/api/bee/'+path,{method,headers:{...await gatewayAuthorizationHeaders(),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,cache:'no-store'});
 const data=await r.json();if(!r.ok)throw Error(data.error??'Bee connection failed.');return data;
}
export default function BeeConnection({onCount}:{onCount?:(count:number)=>void}){
 const [status,setStatus]=useState<Status|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 useEffect(()=>{
  let live=true;const query=new URLSearchParams(location.search),result=query.get('bee');
  if(result){const expected=sessionStorage.getItem('veltra-bee-state');sessionStorage.removeItem('veltra-bee-state');if(!expected||expected!==query.get('state'))setError('Connection attempt expired. Check Bee’s status below.');else if(result==='connected')setNotice('Bee connected. You can now ask Bee in Chat.');else setError(result==='cancelled'?'Bee connection cancelled.':'Bee could not connect. Try again.');history.replaceState(null,'','/settings/connections');}
  void call<Status>('status').then(s=>{if(live)setStatus(s);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};
 },[]);
 useEffect(()=>{onCount?.(status?.connected?1:0);},[status?.connected,onCount]);
 async function act(){setBusy(true);setError('');setNotice('');try{
  if(status?.connected){await call('status','DELETE');setStatus({connected:false,tools:[]});setNotice('Bee disconnected from Onixus Workspace. You can revoke remaining access in LiveAskew.');}
  else {const browser=crypto.randomUUID();sessionStorage.setItem('veltra-bee-state',browser);const {url}=await call<{url:string}>('start','POST',{browser});if(new URL(url).protocol!=='https:')throw Error('Invalid Bee connection URL.');location.assign(url);}
 }catch(e){setError(e instanceof Error?e.message:'Bee could not connect.');}finally{setBusy(false);}}
 return <article className="hub-card" id="bee-connector"><div className="hub-card-top"><ToolLogo name="LiveAskew / Bee"/><span className={`hub-status ${status?.connected?'live':''}`}>{status?.connected?'Connected':status?'Available':error?'Unavailable':'Loading…'}</span></div><h3>LiveAskew / Bee</h3><p>Your personal stylist, saved looks and Honey calendar. Access stays with the LiveAskew member who authorizes it.</p>{error&&<p role="alert" className="connections-error">{error}</p>}{notice&&<p role="status">{notice}</p>}<details className="hub-card-settings"><summary>Settings</summary><button className="hub-card-button" disabled={busy||!status} onClick={()=>void act()}>{busy?'Please wait…':status?.connected?'Disconnect Bee':'Connect Bee'}</button>{status?.connected?<><Link className="hub-card-button" href="/">Ask Bee in Chat</Link><small>Try “Ask Bee: what should I wear?” or “Show my Bee calendar”. Bee advice uses your LiveAskew membership allowance.</small></>:<a className="hub-card-button" href="https://www.liveaskew.com/app" target="_blank" rel="noreferrer">Create LiveAskew account / sign in</a>}</details></article>;
}
