"use client";
import type {WorkspaceMode} from "@/lib/workspace-mode";
import Link from "next/link";
import {useEffect,useRef,useState} from "react";
import {Plus,FileText,ImagePlus,Check,Plug} from "lucide-react";
import {crmConnection} from "@/lib/crm-connection";
import ToolLogo from "./tool-logo";
import {connectionRequest,type Provider,type WorkspaceConnection} from "@/lib/connections-client";
import {gatewayAuthorizationHeaders} from "@/lib/client-session";
const names:Record<Provider,string>={github:"GitHub",vercel:"Vercel",supabase:"Supabase",railway:"Railway",n8n:"n8n"};
export default function ChatTools({workspaceMode="personal",onKnowledge,onApp,imageMode,onImageMode,disabled}:{workspaceMode?:WorkspaceMode;onKnowledge:()=>void;onApp:(provider:Provider|"mail"|"crm"|"build"|"tms"|"business"|"shopify")=>void;imageMode:boolean;onImageMode:(value:boolean)=>void;disabled:boolean}){
 const [open,setOpen]=useState(false),[apps,setApps]=useState<WorkspaceConnection[]>([]),[mail,setMail]=useState(false),[crm,setCrm]=useState(false),[loading,setLoading]=useState(false),[failed,setFailed]=useState(false);
 const root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null);
 useEffect(()=>{if(!open)return;let active=true;setLoading(true);setFailed(false);
  const loadMail=async()=>{const response=await fetch("/api/mail/link",{headers:await gatewayAuthorizationHeaders(),cache:"no-store"});if(!response.ok)throw new Error();return response.json() as Promise<{connected:boolean}>;};
  void Promise.allSettled([connectionRequest<{connections:WorkspaceConnection[]}>("status"),loadMail(),crmConnection()]).then(([developers,email,customers])=>{if(!active)return;setApps(developers.status==="fulfilled"?developers.value.connections.filter(c=>c.connected):[]);setCrm(customers.status==="fulfilled"&&customers.value.connected);setMail(email.status==="fulfilled"&&email.value.connected);setFailed(developers.status==="rejected"||email.status==="rejected");setLoading(false);});
  const close=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false);};
  const escape=(event:globalThis.KeyboardEvent)=>{if(event.key==="Escape"){setOpen(false);trigger.current?.focus();}};
  document.addEventListener("pointerdown",close);document.addEventListener("keydown",escape);
  return()=>{active=false;document.removeEventListener("pointerdown",close);document.removeEventListener("keydown",escape);};
 },[open,workspaceMode]);
 useEffect(()=>setOpen(false),[workspaceMode]);
 const run=(action:()=>void)=>{setOpen(false);action();};
 return <div className="chat-tools" ref={root}><button ref={trigger} type="button" className="composer-tool" aria-label="Add to chat" aria-expanded={open} aria-controls="chat-tools-menu" onClick={()=>setOpen(!open)}><Plus size={19}/></button>
 {open&&<div id="chat-tools-menu" className="chat-tools-menu" role="dialog" aria-label="Add to chat">
 <button type="button" onClick={()=>run(onKnowledge)}><FileText size={17}/><span>Add project files</span></button>
 <button type="button" disabled={disabled} onClick={()=>run(()=>onImageMode(!imageMode))}><ImagePlus size={17}/><span>{imageMode?"Switch to text":"Create an image"}</span>{imageMode&&<Check size={14}/>}</button>
 {(workspaceMode==="personal"||workspaceMode==="business")&&<Link href={"/settings/connections?mode="+workspaceMode+"#bee-connector"}><ToolLogo name="LiveAskew / Bee"/><span>LiveAskew / Bee · MCP connector</span></Link>}
 {workspaceMode==="dev"&&<button type="button" onClick={()=>run(()=>onApp("build"))}><ToolLogo name="Veltra"/><span>Super Coder</span></button>}{workspaceMode==="business"&&<><button type="button" onClick={()=>run(()=>onApp("business"))}><ToolLogo name="Veltra"/><span>Veltra Business OS</span></button><button type="button" onClick={()=>run(()=>onApp("tms"))}><ToolLogo name="Onixus TMS"/><span>Onixus TMS</span></button><button type="button" onClick={()=>run(()=>onApp("shopify"))}><ToolLogo name="Shopify"/><span>Shopify</span></button></>}<div className="chat-tools-section">{workspaceMode} connections</div>
 {loading?<p role="status">Loading your apps…</p>:<>{workspaceMode!=="dev"&&mail&&<button type="button" onClick={()=>run(()=>onApp("mail"))}><ToolLogo name="Veltra Mail"/><span>Veltra Mail</span></button>}{workspaceMode==="business"&&crm&&<button type="button" onClick={()=>run(()=>onApp("crm"))}><ToolLogo name="Veltra CRM"/><span>Veltra CRM</span></button>}{workspaceMode==="dev"&&apps.map(app=><button type="button" key={app.provider} onClick={()=>run(()=>onApp(app.provider))}><ToolLogo name={names[app.provider]}/><span>{names[app.provider]}{app.selection.name&&<small>{app.selection.name}</small>}</span></button>)}{(workspaceMode==="dev"||!mail)&&(workspaceMode!=="business"||!crm)&&(workspaceMode!=="dev"||!apps.length)&&!failed&&<p>No apps connected yet.</p>}{failed&&<p role="status">Some apps couldn’t be loaded. Try reopening this menu.</p>}</>}
 <Link href={"/settings/connections?mode="+workspaceMode}><Plug size={16}/><span>Manage connections</span></Link>
 </div>}</div>;
}

