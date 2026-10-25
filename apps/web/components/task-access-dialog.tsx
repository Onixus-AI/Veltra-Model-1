'use client';
import {useEffect,useRef} from 'react';
import {ShieldCheck,Mail,Users,Brain,Globe,Plug} from 'lucide-react';
import ToolLogo from './tool-logo';
import type {AccessRequest} from '@/lib/task-access-client';
export default function TaskAccessDialog({request,onDecision}:{request:AccessRequest;onDecision:(allowed:boolean)=>void}){
 const dialog=useRef<HTMLDialogElement>(null),deny=useRef<HTMLButtonElement>(null);
 useEffect(()=>{const el=dialog.current,previous=document.activeElement instanceof HTMLElement?document.activeElement:null;el?.showModal();deny.current?.focus();return()=>{el?.close();if(previous?.isConnected)previous.focus();};},[]);
 const Icon=request.app==='mail'?Mail:request.app==='crm'?Users:request.app==='brain'?Brain:request.app==='browser'?Globe:Plug;
 return <dialog ref={dialog} className="task-access-dialog" aria-labelledby="task-access-title" aria-describedby="task-access-description" onCancel={event=>{event.preventDefault();onDecision(false);}}><header>{['github','vercel','supabase','railway','n8n','bee','shopify'].includes(request.app)?<ToolLogo name={request.name}/>:<Icon size={28}/>}<ShieldCheck size={22}/></header><h2 id="task-access-title">Allow access to {request.name}?</h2><p id="task-access-description">Onixus Workspace is requesting this app for the current task. Your account can remain connected without granting access.</p><dl><dt>Task</dt><dd>{request.purpose}</dd><dt>Requested access</dt><dd>{request.reason}</dd><dt>Duration</dt><dd>This task only, ending when the request finishes or after one hour.</dd></dl><p>Existing background automation continues. Sending, deleting and publishing still follow their separate action controls.</p><footer><button ref={deny} type="button" onClick={()=>onDecision(false)}>Deny</button><button type="button" className="primary" onClick={()=>onDecision(true)}>Allow for this task</button></footer></dialog>;
}
