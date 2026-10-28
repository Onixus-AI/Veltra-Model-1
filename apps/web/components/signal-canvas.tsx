'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {gatewayAuthorizationHeaders} from '@/lib/client-session';
const SIGNAL='https://www.onixus.xyz';
export default function SignalCanvas({workspace:initial='',onClose}:{workspace?:string;onClose?:()=>void}){
 const frame=useRef<HTMLIFrameElement>(null),[spaces,setSpaces]=useState<{id:string;name:string}[]>([]),[workspace,setWorkspace]=useState(initial),[error,setError]=useState(''),[attempt,setAttempt]=useState(0),[opening,setOpening]=useState(true);
 useEffect(()=>{if(initial)setWorkspace(initial);},[initial]);
 useEffect(()=>{let live=true;void(async()=>{try{const r=await fetch('/api/crm/workspaces',{headers:await gatewayAuthorizationHeaders(),cache:'no-store'});const d=await r.json();if(!r.ok)throw Error('Businesses could not load.');if(live){setSpaces(d.workspaces??[]);setWorkspace(current=>d.workspaces?.some((s:{id:string})=>s.id===current)?current:d.workspaces?.length===1?d.workspaces[0].id:'');}}catch{if(live){setError('Businesses could not load. Check your Workspace sign-in.');setOpening(false);}}})();return()=>{live=false;};},[]);
 useEffect(()=>{if(!workspace)return;let active=true,requested=false;const controller=new AbortController();setError('');setOpening(true);
  const receive=async(event:MessageEvent)=>{
   if(event.origin!==SIGNAL||event.source!==frame.current?.contentWindow||event.data?.type!=='onixus.signal.ready'||typeof event.data.nonce!=='string'||event.data.nonce.length>64||requested)return;
   requested=true;
   try{const r=await fetch('/api/workspace/signal/launch',{method:'POST',headers:{...await gatewayAuthorizationHeaders(),'Content-Type':'application/json'},body:JSON.stringify({workspace}),cache:'no-store',signal:controller.signal});const d=await r.json();if(!r.ok)throw Error(d.error||'Signal could not open.');if(active){frame.current?.contentWindow?.postMessage({type:'onixus.signal.session',nonce:event.data.nonce,token_hash:d.token_hash,client_id:d.client_id},SIGNAL);setOpening(false);}}
   catch(e){if(active){setError(e instanceof Error?e.message:'Signal could not open.');setOpening(false);}}
  };
  window.addEventListener('message',receive);const timer=setTimeout(()=>{if(active&&!requested){setError('Signal did not respond. Reload Signal to try again.');setOpening(false);}},25000);
  return()=>{active=false;controller.abort();clearTimeout(timer);window.removeEventListener('message',receive);};
 },[workspace,attempt]);
 return <section className="mail-canvas"><header><div><img src="/brands/onixus-signal-icon-v2.png" width={24} height={24} alt=""/><strong>Signal</strong></div><div><label>Business <select value={workspace} onChange={e=>setWorkspace(e.target.value)}><option value="">Choose a business</option>{spaces.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select></label><Link href={'/crm?view=Connections'+(workspace?'&workspace='+encodeURIComponent(workspace):'')}>Connection settings</Link><button onClick={()=>setAttempt(n=>n+1)}>Reload Signal</button>{onClose&&<button onClick={onClose}>Back to canvas</button>}</div></header>
 {error?<div className="mail-canvas-state" role="alert"><h2>Open Signal</h2><p>{error}</p><Link href={'/crm?view=Connections'+(workspace?'&workspace='+encodeURIComponent(workspace):'')}>Manage Signal connection</Link></div>:workspace?<><p role="status" hidden={!opening}>Opening Signal…</p><iframe key={workspace+':'+attempt} ref={frame} title="Signal workspace" src={SIGNAL+'/workspace/embedded'} referrerPolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals"/></>:<div className="mail-canvas-state">Choose the business whose Signal account you want to open.</div>}</section>;
}
