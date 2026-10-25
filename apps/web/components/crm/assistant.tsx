"use client";
import TaskAccessDialog from '../task-access-dialog';
import {TaskAccessClient,type AccessRequest} from '@/lib/task-access-client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {formatCrmReply} from '@/lib/crm/chat-format';
import {db} from '@/lib/crm/client';
import type {CrmReply} from '@/lib/crm/chat-actions';
export default function CrmAssistant({workspace,customer,onChanged}:{workspace:string;customer:string|null;onChanged:()=>void}){
 const [input,setInput]=useState(''),[messages,setMessages]=useState<{role:string;content:string;campaignUrl?:string}[]>([]),[review,setReview]=useState<CrmReply|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [accessRequest,setAccessRequest]=useState<AccessRequest|null>(null);const accessResolver=useRef<((allowed:boolean)=>void)|null>(null),task=useRef<TaskAccessClient|null>(null);
 function askAccess(request:AccessRequest){return new Promise<boolean>(resolve=>{accessResolver.current=resolve;setAccessRequest(request);});}
 function answerAccess(allowed:boolean){setAccessRequest(null);accessResolver.current?.(allowed);accessResolver.current=null;}
 function endAccess(){void task.current?.finish();task.current=null;answerAccess(false);setReview(null);}
 useEffect(()=>()=>{accessResolver.current?.(false);void task.current?.finish();},[workspace,customer]);
 const scope=useRef(''),locked=useRef(false);scope.current=workspace+':'+(customer??'');
 useEffect(()=>{setMessages([]);setReview(null);setInput('');setError('');setAccessRequest(null);},[workspace,customer]);
 async function send(message?:string,review_id?:string){
  if(locked.current||!db||!workspace)return;locked.current=true;setBusy(true);setError('');const requested=scope.current;setReview(null);
  if(message){setMessages(old=>[...old,{role:'You',content:message}]);setInput('');}
  let keepTask=false;const currentTask=review_id&&task.current?task.current:new TaskAccessClient(message||'Apply the reviewed CRM change',askAccess);if(task.current&&task.current!==currentTask)await task.current.finish();task.current=currentTask;
  try{
   const {data}=await db.auth.getSession();if(!data.session)throw new Error('Sign in to use CRM Chat.');
   const r=await currentTask.fetch('/api/crm/assistant',{method:'POST',headers:{Authorization:`Bearer ${data.session.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({task_id:currentTask.id,workspace_id:workspace,customer_id:customer,...(review_id?{review_id}:{message})}),cache:'no-store'});
   const result=await r.json();if(!r.ok)throw new Error(result.error||'CRM could not complete the request.');if(requested!==scope.current)return;
   setMessages(old=>[...old,{role:'Onixus Workspace',content:formatCrmReply(result),...(typeof result.campaign_url==='string'&&result.campaign_url.startsWith('/crm?')?{campaignUrl:result.campaign_url}:{})}]);
   if(result.kind==='preview'){keepTask=true;setReview(result);}if(result.changed)onChanged();
  }catch(e){if(requested===scope.current)setError(e instanceof Error?e.message:'CRM request failed.');}finally{if(!keepTask){await currentTask.finish();if(task.current===currentTask)task.current=null;}locked.current=false;setBusy(false);}
 }
 function submit(e:FormEvent){e.preventDefault();if(input.trim())void send(input.trim());}
 return <section className="crm-panel crm-assistant" aria-label="Onixus CRM Chat"><h2>Chat with Onixus Workspace</h2>{accessRequest&&<TaskAccessDialog request={accessRequest} onDecision={answerAccess}/>}<p>{customer?'Working with the selected customer.':'Working with this workspace.'} Try “Show customers”, “Show overdue tasks” or “Show pipeline”. Shared brain: “Show brain” or “Remember for business: our support hours are 9–5 Eastern”. Memories and changes require review.</p><div role="log" aria-label="CRM conversation" aria-live="polite">{messages.map((m,i)=><article key={i}><b>{m.role}</b><pre>{m.content}</pre>{m.campaignUrl&&<a href={m.campaignUrl}>Review campaign template</a>}</article>)}</div>{error&&<p role="alert">{error}</p>}{review&&<div className="crm-chat-review"><p>Confirm the exact record or shared-memory change shown above?</p><button disabled={busy} onClick={()=>void send(undefined,review.review_id)}>Confirm CRM change</button><button disabled={busy} onClick={endAccess}>Dismiss</button></div>}{busy&&task.current?.active&&<button type="button" onClick={endAccess}>End app access</button>}<form onSubmit={submit}><label>Message Onixus Workspace<textarea value={input} onChange={e=>setInput(e.target.value)} maxLength={3000} rows={2} disabled={busy} placeholder="Show overdue tasks"/></label><button className="primary" disabled={busy||!input.trim()}>{busy?'Working…':'Send'}</button></form></section>;
}
