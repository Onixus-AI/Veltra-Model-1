"use client";
import Link from "next/link";
import {useEffect,useRef,useState} from "react";
import {Plus,FileText,ImagePlus,Check,Plug} from "lucide-react";
import ToolLogo from "./tool-logo";
import {connectionRequest,type Provider,type WorkspaceConnection} from "@/lib/connections-client";
import {gatewayAuthorizationHeaders} from "@/lib/client-session";
const names:Record<Provider,string>={github:"GitHub",vercel:"Vercel",supabase:"Supabase",railway:"Railway",n8n:"n8n"};
export default function ChatTools({onKnowledge,onApp,imageMode,onImageMode,disabled}:{onKnowledge:()=>void;onApp:(provider:Provider|"mail")=>void;imageMode:boolean;onImageMode:(value:boolean)=>void;disabled:boolean}){
 const [open,setOpen]=useState(false),[apps,setApps]=useState<WorkspaceConnection[]>([]),[mail,setMail]=useState(false),[loading,setLoading]=useState(false),[failed,setFailed]=useState(false);
 const root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null);
 useEffect(()=>{if(!open)return;let active=true;setLoading(true);setFailed(false);
  const loadMail=async()=>{const response=await fetch("/api/mail/link",{headers:await gatewayAuthorizationHeaders(),cache:"no-store"});if(!response.ok)throw new Error();return response.json() as Promise<{connected:boolean}>;};
  void Promise.allSettled([connectionRequest<{connections:WorkspaceConnection[]}>("status"),loadMail()]).then(([developers,email])=>{if(!active)return;setApps(developers.status==="fulfilled"?developers.value.connections.filter(c=>c.connected):[]);setMail(email.status==="fulfilled"&&email.value.connected);setFailed(developers.status==="rejected"||email.status==="rejected");setLoading(false);});
  const close=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false);};
  const escape=(event:globalThis.KeyboardEvent)=>{if(event.key==="Escape"){setOpen(false);trigger.current?.focus();}};
  document.addEventListener("pointerdown",close);document.addEventListener("keydown",escape);
  return()=>{active=false;document.removeEventListener("pointerdown",close);document.removeEventListener("keydown",escape);};
 },[open]);
 const run=(action:()=>void)=>{setOpen(false);action();};
 return <div className="chat-tools" ref={root}><button ref={trigger} type="button" className="composer-tool" aria-label="Add to chat" aria-expanded={open} aria-controls="chat-tools-menu" onClick={()=>setOpen(!open)}><Plus size={19}/></button>
 {open&&<div id="chat-tools-menu" className="chat-tools-menu" role="dialog" aria-label="Add to chat">
 <button type="button" onClick={()=>run(onKnowledge)}><FileText size={17}/><span>Add project files</span></button>
 <button type="button" disabled={disabled} onClick={()=>run(()=>onImageMode(!imageMode))}><ImagePlus size={17}/><span>{imageMode?"Switch to text":"Create an image"}</span>{imageMode&&<Check size={14}/>}</button>
 <div className="chat-tools-section">Connected apps</div>
 {loading?<p role="status">Loading your apps…</p>:<>{mail&&<button type="button" onClick={()=>run(()=>onApp("mail"))}><ToolLogo name="Veltra Mail"/><span>Veltra Mail</span></button>}{apps.map(app=><button type="button" key={app.provider} onClick={()=>run(()=>onApp(app.provider))}><ToolLogo name={names[app.provider]}/><span>{names[app.provider]}{app.selection.name&&<small>{app.selection.name}</small>}</span></button>)}{!mail&&!apps.length&&!failed&&<p>No apps connected yet.</p>}{failed&&<p role="status">Some apps couldn’t be loaded. Try reopening this menu.</p>}</>}
 <Link href="/settings/connections"><Plug size={16}/><span>Manage connections</span></Link>
 </div>}</div>;
}
