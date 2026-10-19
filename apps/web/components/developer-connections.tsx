"use client";
import Link from "next/link";
import ToolLogo from "@/components/tool-logo";
import {useCallback,useEffect,useState,type ReactNode} from "react";
import {ArrowUpRight} from "lucide-react";
import {connectionRequest,type Provider,type WorkspaceConnection} from "@/lib/connections-client";
const providers=[{id:"github" as Provider,name:"GitHub",description:"Choose a repository. Read files, edit code and propose a draft pull request."},{id:"vercel" as Provider,name:"Vercel",description:"Choose a project and inspect its deployments beside your code."},{id:"supabase" as Provider,name:"Supabase",description:"Choose a database project and keep its details beside Chat."},{id:"railway" as Provider,name:"Railway",description:"Choose an authorized Railway project and keep it beside your code."},{id:"n8n" as Provider,name:"n8n",description:"Connect n8n Cloud and choose a workflow to keep beside Chat."}];
type Resource={id:string;name:string;branch?:string};
export default function DeveloperConnections({query="",onCount,children}:{query?:string;onCount?:(count:number)=>void;children?:ReactNode}){
 const [instance,setInstance]=useState("");
 const [expanded,setExpanded]=useState<string|null>(null);
 const [connections,setConnections]=useState<WorkspaceConnection[]>([]),[error,setError]=useState(""),[notice,setNotice]=useState(""),[busy,setBusy]=useState("");
 const [choices,setChoices]=useState<Record<string,Resource[]>>({}),[selected,setSelected]=useState<Record<string,string>>({});
 const refresh=useCallback(async()=>{try{setConnections((await connectionRequest<{connections:WorkspaceConnection[]}>("status")).connections);}catch(e){setError(e instanceof Error?e.message:"Could not load developer connections.");}},[]);
 useEffect(()=>{
  const query=new URLSearchParams(location.search),result=query.get("developer"),provider=query.get("provider");
  if(result){const key=`veltra-connect-${provider}`,expected=sessionStorage.getItem(key);sessionStorage.removeItem(key);if(!expected||expected!==query.get("state"))setError("Connection attempt expired. Check its current status below.");else if(result==="connected")setNotice("Account connected. Choose the repository or project Veltra can use.");else setError(result==="cancelled"?"Connection cancelled.":"Connection did not finish. Try again.");history.replaceState(null,"","/settings/connections");}
  void refresh();
 },[refresh]);
 useEffect(()=>{onCount?.(connections.filter(c=>c.connected).length);},[connections,onCount]);
 async function act(provider:Provider,action:"connect"|"disconnect"|"choose"|"select"){
  setBusy(provider);setError("");setNotice("");
  try{
   if(action==="connect"){const browser=crypto.randomUUID();sessionStorage.setItem(`veltra-connect-${provider}`,browser);const {url}=await connectionRequest<{url:string}>(`${provider}/start`,"POST",{browser,...(provider==="n8n"?{instance}:{})});if(new URL(url).protocol!=="https:")throw new Error("Invalid authorization URL.");location.assign(url);}
   if(action==="disconnect"){await connectionRequest(provider,"DELETE");setChoices(value=>({...value,[provider]:[]}));await refresh();setNotice("Disconnected from Veltra. You can also revoke the app in the provider’s account settings.");}
   if(action==="choose"){const data=await connectionRequest<{resources:Resource[]}>(`${provider}/resources`);setChoices(value=>({...value,[provider]:data.resources}));setSelected(value=>({...value,[provider]:connections.find(c=>c.provider===provider)?.selection.id??data.resources[0]?.id??""}));}
   if(action==="select"){await connectionRequest(`${provider}/select`,"POST",{id:selected[provider]});await refresh();setNotice("Selection saved. Open the developer workspace to start.");}
  }catch(e){setError(e instanceof Error?e.message:"Connection request failed.");}finally{setBusy("");}
 }
 return <>
 {error&&<p role="alert" className="connections-error">{error}</p>}{notice&&<p role="status" className="connections-notice">{notice}</p>}
 <div className="hub-grid">{providers.filter(p=>`${p.name} ${p.description}`.toLowerCase().includes(query.toLowerCase())).map(({id,name,description})=>{
 const connection=connections.find(c=>c.provider===id),open=expanded===id;
 return <article className={`hub-card provider-${id} ${open?"expanded":""}`} key={id}>
 <div className="hub-card-top"><ToolLogo name={name}/><span className={`hub-status ${connection?.connected?"live":""}`}>{connection?.connected?"Connected":connection?.configured?"Available":connection?"Setup needed":error?"Unavailable":"Loading…"}</span></div>
 <h3>{name}</h3><p>{connection?.selection.name??description}</p>
 <button className="hub-card-button" aria-expanded={open} onClick={()=>setExpanded(open?null:id)}>{"Settings"}<ArrowUpRight size={13}/></button>
 {open&&<div className="hub-card-details">
 <p>{description}</p>{connection?.account.name&&<p>{connection.account.name}</p>}
 {id==="n8n"&&!connection?.connected&&<label htmlFor="n8n-instance">n8n Cloud address<input id="n8n-instance" type="url" placeholder="https://your-workspace.app.n8n.cloud" value={instance} onChange={e=>setInstance(e.target.value)}/></label>}
 <div className="developer-card-actions">{connection?.connected?<><button disabled={busy===id} onClick={()=>void act(id,"choose")}>{id==="github"?"Choose repository":id==="n8n"?"Choose workflow":"Choose project"}</button>{connection.selection.id&&<Link href={`/?canvas=code&tool=${id}`}>Open workspace <ArrowUpRight size={13}/></Link>}<button disabled={busy===id} onClick={()=>void act(id,"disconnect")}>Disconnect</button></>:<button disabled={!connection?.configured||busy===id||(id==="n8n"&&!instance.trim())} onClick={()=>void act(id,"connect")}>Connect {name}</button>}</div>
 {!connection?.configured&&connection&&!connection.connected&&<p className="developer-setup-note">Veltra’s account connection is still being configured. {connection.setup_required?.length?`Missing setup: ${connection.setup_required.join(', ')}.`:''} {connection.callback_url&&<span>Registered callback: <code>{connection.callback_url}</code></span>} {id==='vercel'&&<span>Register a Vercel integration with read access to Projects and Deployments, then save its credentials privately in the Mail service. Hosting and this account connector have separate setup.</span>}</p>}
 {choices[id]&&choices[id].length>0&&<div className="developer-resource-picker"><label htmlFor={`resource-${id}`}>{id==="github"?"Repository":id==="n8n"?"Workflow":"Project"}</label><select id={`resource-${id}`} value={selected[id]??""} onChange={e=>setSelected(value=>({...value,[id]:e.target.value}))}>{choices[id].map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select><button disabled={busy===id||!selected[id]} onClick={()=>void act(id,"select")}>Use this {id==="github"?"repository":id==="n8n"?"workflow":"project"}</button></div>}{choices[id]?.length===0&&<p>No accessible {id==="github"?"repositories":id==="n8n"?"workflows":"projects"} found.</p>}
 </div>}</article>;})}{children}</div></>;
}

