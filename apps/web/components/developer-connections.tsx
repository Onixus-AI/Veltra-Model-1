"use client";
import Link from "next/link";
import {useCallback,useEffect,useState} from "react";
import {Github,Triangle,Database,ArrowUpRight} from "lucide-react";
import {connectionRequest,type Provider,type WorkspaceConnection} from "@/lib/connections-client";
const providers=[{id:"github" as Provider,name:"GitHub",description:"Choose a repository. Read files, edit code and propose a draft pull request.",Icon:Github},{id:"vercel" as Provider,name:"Vercel",description:"Choose a project and inspect its deployments beside your code.",Icon:Triangle},{id:"supabase" as Provider,name:"Supabase",description:"Choose a database project and keep its details beside Chat.",Icon:Database}];
type Resource={id:string;name:string;branch?:string};
export default function DeveloperConnections(){
 const [connections,setConnections]=useState<WorkspaceConnection[]>([]),[error,setError]=useState(""),[notice,setNotice]=useState(""),[busy,setBusy]=useState("");
 const [choices,setChoices]=useState<Record<string,Resource[]>>({}),[selected,setSelected]=useState<Record<string,string>>({});
 const refresh=useCallback(async()=>{try{setConnections((await connectionRequest<{connections:WorkspaceConnection[]}>("status")).connections);}catch(e){setError(e instanceof Error?e.message:"Could not load developer connections.");}},[]);
 useEffect(()=>{
  const query=new URLSearchParams(location.search),result=query.get("developer"),provider=query.get("provider");
  if(result){const key=`veltra-connect-${provider}`,expected=sessionStorage.getItem(key);sessionStorage.removeItem(key);if(!expected||expected!==query.get("state"))setError("Connection attempt expired. Check its current status below.");else if(result==="connected")setNotice("Account connected. Choose the repository or project Veltra can use.");else setError(result==="cancelled"?"Connection cancelled.":"Connection did not finish. Try again.");history.replaceState(null,"","/settings/connections");}
  void refresh();
 },[refresh]);
 async function act(provider:Provider,action:"connect"|"disconnect"|"choose"|"select"){
  setBusy(provider);setError("");setNotice("");
  try{
   if(action==="connect"){const browser=crypto.randomUUID();sessionStorage.setItem(`veltra-connect-${provider}`,browser);const {url}=await connectionRequest<{url:string}>(`${provider}/start`,"POST",{browser});if(new URL(url).protocol!=="https:")throw new Error("Invalid authorization URL.");location.assign(url);}
   if(action==="disconnect"){await connectionRequest(provider,"DELETE");setChoices(value=>({...value,[provider]:[]}));await refresh();setNotice("Disconnected from Veltra. You can also revoke the app in the provider’s account settings.");}
   if(action==="choose"){const data=await connectionRequest<{resources:Resource[]}>(`${provider}/resources`);setChoices(value=>({...value,[provider]:data.resources}));setSelected(value=>({...value,[provider]:connections.find(c=>c.provider===provider)?.selection.id??data.resources[0]?.id??""}));}
   if(action==="select"){await connectionRequest(`${provider}/select`,"POST",{id:selected[provider]});await refresh();setNotice("Selection saved. Open the developer workspace to start.");}
  }catch(e){setError(e instanceof Error?e.message:"Connection request failed.");}finally{setBusy("");}
 }
 return <section className="developer-connections" aria-labelledby="developer-title"><div className="connections-section-heading"><h2 id="developer-title">Build with your workspace</h2><span>Code · Deployments · Database</span></div>
 {error&&<p role="alert" className="connections-error">{error}</p>}{notice&&<p role="status" className="connections-notice">{notice}</p>}
 <div className="developer-connection-grid">{providers.map(({id,name,description,Icon})=>{const connection=connections.find(c=>c.provider===id);return <article className={`developer-connection-card provider-${id}`} key={id}><div className="developer-card-heading"><Icon size={25}/><h3>{name}</h3><span>{connection?.connected?"Connected":connection?.configured?"Not connected":connection?"Veltra setup required":"Loading…"}</span></div><p>{description}</p>{connection?.connected&&<p className="developer-account">{connection.account.name} {connection.selection.name&&<strong>{connection.selection.name}</strong>}</p>}
 <div className="developer-card-actions">{connection?.connected?<><button disabled={busy===id} onClick={()=>void act(id,"choose")}>{id==="github"?"Choose repository":"Choose project"}</button><button disabled={busy===id} onClick={()=>void act(id,"disconnect")}>Disconnect</button>{connection.selection.id&&<Link href={`/?canvas=code&tool=${id}`}>Open workspace <ArrowUpRight size={15}/></Link>}</>:<button disabled={!connection?.configured||busy===id} onClick={()=>void act(id,"connect")}>Connect {name}</button>}</div>
 {!connection?.configured&&connection&&!connection.connected&&<p className="developer-setup-note">Veltra’s OAuth app must be registered before clients can connect. Your Google Mail connection remains separate.</p>}
 {choices[id]&&choices[id].length>0&&<div className="developer-resource-picker"><label htmlFor={`resource-${id}`}>{id==="github"?"Repository":"Project"}</label><select id={`resource-${id}`} value={selected[id]??""} onChange={e=>setSelected(value=>({...value,[id]:e.target.value}))}>{choices[id].map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select><button disabled={busy===id||!selected[id]} onClick={()=>void act(id,"select")}>Use this {id==="github"?"repository":"project"}</button></div>}{choices[id]?.length===0&&<p>No accessible {id==="github"?"repositories":"projects"} found for this connection.</p>}</article>;})}</div></section>;
}
