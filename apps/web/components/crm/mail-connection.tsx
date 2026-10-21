'use client';
import QuoteOutcomes from './quote-outcomes';
import {useEffect,useRef,useState} from 'react';
import {Mail} from 'lucide-react';
import {db} from '@/lib/crm/client';
type Status={connected:boolean;workspace_id:string|null;pending?:number;blocked?:number;last_error?:string|null};
export default function MailConnection({workspace,preview}:{workspace:string;preview:boolean}){
 const [status,setStatus]=useState<Status|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const sequence=useRef(0),controller=useRef<AbortController|null>(null);
 async function request(method='GET',body?:unknown){
  const version=++sequence.current;controller.current?.abort();const abort=new AbortController();controller.current=abort;const timer=setTimeout(()=>abort.abort(),30000);setBusy(true);setError('');
  try{if(!db)throw Error('CRM sign-in is required to check Mail.');const {data}=await db.auth.getSession();if(!data.session)throw Error('Sign in before checking Mail.');const headers={'Content-Type':'application/json',Authorization:`Bearer ${data.session.access_token}`};
   const call=async(verb:string,payload?:unknown)=>{const response=await fetch('/api/crm/mail',{method:verb,headers,body:payload?JSON.stringify(payload):undefined,cache:'no-store',signal:abort.signal});const result=await response.json();if(!response.ok)throw Error(result.error||'Mail is unavailable.');return result;};
   const result=await call(method,body);const next=method==='GET'?result:await call('GET');if(typeof next.connected!=='boolean')throw Error('Mail returned an unreadable connection status.');if(version===sequence.current)setStatus(next);
  }catch(e){if(version===sequence.current)setError((e instanceof Error&&e.name!=='AbortError'?e.message:'Mail status timed out.')+(method==='GET'?' Refresh status before taking action.':' The action may have been recorded. Refresh status before trying again.'));}finally{clearTimeout(timer);if(version===sequence.current)setBusy(false);}
 }
 useEffect(()=>{setStatus(null);setError('');if(!preview)void request();return()=>{++sequence.current;controller.current?.abort();};},[workspace,preview]);
 const linked=!!status?.connected&&status.workspace_id===workspace;
 const label=preview?'Preview · not checked':error?'Status unavailable':!status?'Checking connection…':linked?'Connected to this workspace':status.connected?'Connected to another workspace':'Not connected';
 return <><section className="crm-panel"><div className="crm-connection-heading"><Mail size={22}/><h2>Veltra Mail</h2><span className="crm-state-badge" data-state={linked&&!error?'active':error?'expired':'review'} role="status">{label}</span></div><p>Link your connected Mail account to this workspace. Only the workspace owner can connect it. Existing Mail approvals stay in place.</p>{preview?<p>Live connection checks and changes are disabled in this preview.</p>:<>{linked&&!error&&<dl className="crm-connection-counts"><div><dt>Events waiting</dt><dd>{typeof status?.pending==='number'?status.pending:'—'}</dd></div><div><dt>Need attention</dt><dd>{typeof status?.blocked==='number'?status.blocked:'—'}</dd></div></dl>}{status?.last_error&&<p role="alert" className="crm-context-error">{status.last_error}</p>}{error&&<p role="alert" className="crm-context-error">{error}</p>}<div className="crm-actions"><button disabled={busy||!status||!!error||status.connected} onClick={()=>void request('POST',{workspace_id:workspace})}>Connect Mail</button><button disabled={busy} onClick={()=>void request()}>{busy?'Checking…':'Refresh status'}</button>{linked&&<><button disabled={busy||!!error} onClick={()=>void request('POST',{action:'retry'})}>Retry pending events</button><button disabled={busy||!!error} onClick={()=>void request('DELETE')}>Disconnect</button></>}</div></>}</section>{!preview&&<QuoteOutcomes workspace={workspace}/>}</>;
}
