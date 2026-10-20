"use client";
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {formatCrmReply} from '@/lib/crm/chat-format';
import {db} from '@/lib/crm/client';
import type {CrmReply} from '@/lib/crm/chat-actions';
export default function CrmAssistant({workspace,customer,onChanged}:{workspace:string;customer:string|null;onChanged:()=>void}){
 const [input,setInput]=useState(''),[messages,setMessages]=useState<{role:string;content:string}[]>([]),[review,setReview]=useState<CrmReply|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const scope=useRef(''),locked=useRef(false);scope.current=workspace+':'+(customer??'');
 useEffect(()=>{setMessages([]);setReview(null);setInput('');setError('');},[workspace,customer]);
 async function send(message?:string,review_id?:string){
  if(locked.current||!db||!workspace)return;locked.current=true;setBusy(true);setError('');const requested=scope.current;setReview(null);
  if(message){setMessages(old=>[...old,{role:'You',content:message}]);setInput('');}
  try{
   const {data}=await db.auth.getSession();if(!data.session)throw new Error('Sign in to use CRM Chat.');
   const r=await fetch('/api/crm/assistant',{method:'POST',headers:{Authorization:`Bearer ${data.session.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({workspace_id:workspace,customer_id:customer,...(review_id?{review_id}:{message})}),cache:'no-store'});
   const result=await r.json();if(!r.ok)throw new Error(result.error||'CRM could not complete the request.');if(requested!==scope.current)return;
   setMessages(old=>[...old,{role:'Veltra',content:formatCrmReply(result)}]);
   if(result.kind==='preview')setReview(result);if(result.changed)onChanged();
  }catch(e){if(requested===scope.current)setError(e instanceof Error?e.message:'CRM request failed.');}finally{locked.current=false;setBusy(false);}
 }
 function submit(e:FormEvent){e.preventDefault();if(input.trim())void send(input.trim());}
 return <section className="crm-panel crm-assistant" aria-label="Veltra CRM Chat"><h2>Chat with Veltra</h2><p>{customer?'Working with the selected customer.':'Working with this workspace.'} Try “Show customers”, “Show overdue tasks” or “Show pipeline”. Changes require review.</p><div role="log" aria-label="CRM conversation" aria-live="polite">{messages.map((m,i)=><article key={i}><b>{m.role}</b><pre>{m.content}</pre></article>)}</div>{error&&<p role="alert">{error}</p>}{review&&<div className="crm-chat-review"><p>Confirm the exact change shown above?</p><button disabled={busy} onClick={()=>void send(undefined,review.review_id)}>Confirm CRM change</button><button disabled={busy} onClick={()=>setReview(null)}>Dismiss</button></div>}<form onSubmit={submit}><label>Message Veltra<textarea value={input} onChange={e=>setInput(e.target.value)} maxLength={3000} rows={2} disabled={busy} placeholder="Show overdue tasks"/></label><button className="primary" disabled={busy||!input.trim()}>{busy?'Working…':'Send'}</button></form></section>;
}
