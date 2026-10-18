"use client";
import Link from "next/link";
import {crmConnection,setCrmConnection,type CrmConnection} from "@/lib/crm-connection";
import ToolLogo from "@/components/tool-logo";
import BeeConnection from "@/components/bee-connection";
import DeveloperConnections from "@/components/developer-connections";
import { useCallback, useEffect, useState, useRef } from "react";
import { ArrowLeft, ArrowUpRight, Search, X, Layers, Code2, Briefcase, Palette, Building2, Megaphone, BookOpen, Users, Plug } from "lucide-react";
import { connectorSections, type CatalogTool } from "@/lib/connector-catalog";
import { gatewayAuthorizationHeaders } from "@/lib/client-session";

type Connection = { connected: boolean; mailbox: { email: string } | null; mail_url: string };
const LINK_STATE = "veltra-mail-link-state";
async function call<T>(method: string, body?: object): Promise<T> {
  const response = await fetch("/api/mail/link", { method, cache: "no-store", headers: { ...await gatewayAuthorizationHeaders(), "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Could not connect to Veltra Mail.");
  return data as T;
}
export default function ConnectionsPage() {
  const [crm,setCrm]=useState<CrmConnection|null>(null),[crmBusy,setCrmBusy]=useState(false),[crmError,setCrmError]=useState("");
  useEffect(()=>{let live=true;void crmConnection().then(value=>{if(live)setCrm(value);}).catch(()=>{if(live)setCrmError("CRM connection could not be loaded.");});return()=>{live=false;};},[]);
  async function toggleCrm(){setCrmBusy(true);setCrmError("");try{await setCrmConnection(!crm?.connected);setCrm(await crmConnection());setNotice(crm?.connected?"CRM disconnected from this workspace. Your CRM records are preserved.":"Veltra CRM is connected. Open it beside Chat.");}catch(e){setCrmError(e instanceof Error?e.message:"CRM could not connect.");}finally{setCrmBusy(false);}}
  const [query,setQuery]=useState("");
  const [showPlanned,setShowPlanned]=useState(false);
  const available=(name:string)=>["LiveAskew / Bee","Veltra CRM","Onixus TMS","Shopify","Veltra Gather"].includes(name);
  const [category,setCategory]=useState("all");
  const [developerCount,setDeveloperCount]=useState(0);
  const [beeCount,setBeeCount]=useState(0);
  const [detail,setDetail]=useState<CatalogTool|null>(null);
  const detailDialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{if(detail)detailDialog.current?.showModal();else detailDialog.current?.close();},[detail]);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const refresh = useCallback(async () => {
    try { setConnection(await call<Connection>("GET")); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load connections."); }
  }, []);
  useEffect(() => {
    const query = new URLSearchParams(location.search);
    const result = query.get("mail");
    if (result) {
      const expected = sessionStorage.getItem(LINK_STATE);
      sessionStorage.removeItem(LINK_STATE);
      if (!expected || query.get("state") !== expected) setError("Check your connection below. This attempt started in another browser session.");
      else if (result === "connected") setNotice("Google is connected. Open Veltra Mail below to use your workspace in the canvas.");
      else setError(result === "cancelled" ? "Google connection cancelled." : "Google connection could not finish. Try again and grant the requested Mail permissions.");
      history.replaceState(null, "", "/settings/connections");
    }
    void refresh();
  }, [refresh]);
  async function connect(disconnect = false) {
    setBusy(true); setError(""); setNotice("");
    try {
      if (disconnect) { await call("DELETE"); await refresh(); setNotice("Google disconnected from Chat. Standalone Veltra Mail remains available."); }
      else {
        const browser = crypto.randomUUID(); sessionStorage.setItem(LINK_STATE, browser);
        const { url } = await call<{ url: string }>("POST", { browser });
        if (new URL(url).protocol !== "https:") throw new Error("Mail connection URL is invalid.");
        location.assign(url);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Please try again."); }
    finally { setBusy(false); }
  }
  const icons=[Code2,Briefcase,Palette,Building2,Megaphone,Users,BookOpen,Plug];
  const matches=(name:string)=>name.toLowerCase().includes(query.toLowerCase());
  const planned=(tool:CatalogTool)=>tool.name==='LiveAskew / Bee'?<BeeConnection key={tool.name} onCount={setBeeCount}/>:tool.name==='Veltra Gather'?<article className="hub-card" key={tool.name}><div className="hub-card-top"><ToolLogo name={tool.name}/><span className="hub-status">Private preview</span></div><h3>Veltra Gather</h3><p>Event tasks, vendors, budgets and timelines, using the Zee backend model.</p><button className="hub-card-button" onClick={()=>setDetail(tool)}>View setup requirements</button><small>Read-only MCP prepared. Backend authorization and workspace UI are pending.</small></article>:tool.name==='Shopify'?<article className="hub-card" key={tool.name}><div className="hub-card-top"><ToolLogo name="Shopify"/><span className="hub-status">Customer setup</span></div><h3>Shopify</h3><p>Authorize your own store, read its catalog and review supported product edits.</p><Link className="hub-card-button" href="/?canvas=shopify">Open store connector <ArrowUpRight size={13}/></Link><small>Customer installation requires Veltra's registered Shopify app.</small></article>:tool.name==='Onixus TMS'?<article className="hub-card" key={tool.name}><div className="hub-card-top"><ToolLogo name="Onixus TMS"/><span className="hub-status">Available</span></div><h3>Onixus TMS</h3><p>Transport operations for drayage, trucking and service businesses. Connect the same Mail inbox and CRM workspace.</p><Link className="hub-card-button" href="/?canvas=tms">Open TMS connector <ArrowUpRight size={13}/></Link><a className="hub-card-button" href="https://onixus-logistics-os.up.railway.app/" target="_blank" rel="noreferrer">Open Business OS workspace</a></article>:tool.name==='Veltra CRM'?<article className="hub-card" key={tool.name} id="crm-connector"><div className="hub-card-top"><ToolLogo name={tool.name}/><span className={`hub-status ${crm?.connected?'live':''}`}>{crm?.connected?'Connected':crm?'Available':crmError?'Unavailable':'Loading…'}</span></div><h3>Veltra CRM</h3><p>Your customers, pipeline and tasks, beside Chat. Uses CRM workspaces on this Veltra account.</p>{crmError&&<p role="alert">{crmError}</p>}{crm?.connected&&<Link className="hub-card-button" href="/?canvas=crm">Open CRM <ArrowUpRight size={13}/></Link>}<button className="hub-card-button" disabled={crmBusy||!crm} onClick={()=>void toggleCrm()}>{crmBusy?'Saving…':crm?.connected?'Disconnect CRM':'Connect CRM'}</button><small>Customer records are shared with your Veltra CRM. Workspace permissions still apply.</small></article>:<article className="hub-card planned" key={tool.name}><div className="hub-card-top"><ToolLogo name={tool.name}/><span className="hub-status">Planned</span></div><h3>{tool.name}</h3><p>{tool.description}</p><button className="hub-card-button" onClick={()=>setDetail(tool)}>View details <ArrowUpRight size={13}/></button></article>;
  return <main className="connections-page connector-hub">
    <header className="hub-header"><Link href="/" className="hub-brand"><img src="/veltra-logo.png" alt=""/><span><strong>Veltra</strong><small>by Onixus</small></span></Link><span className="hub-tagline">Your AI workspace.</span><Link href="/" className="hub-back"><ArrowLeft size={14}/>Back to Chat</Link></header>
    <div className="hub-layout"><aside className="hub-sidebar"><p>Your workspace</p><nav aria-label="Connector sections"><button aria-pressed={category==="all"} onClick={()=>setCategory("all")}><Layers size={16}/>All tools</button>{connectorSections.map((section,index)=>{const Icon=icons[index];return <button key={section.id} aria-pressed={category===section.id} onClick={()=>setCategory(section.id)}><Icon size={16}/>{section.name}</button>;})}</nav><div className="hub-side-note"><span className="hub-live-dot"/>{developerCount+beeCount+(connection?.connected?1:0)} accounts connected<small>You control what each tool can access.</small></div></aside>
    <section className="hub-content"><div className="hub-intro"><div><h1>Make it your workspace.</h1><p>Bring your tools together. Connect one, then keep building.</p></div><button className="hub-card-button" aria-pressed={showPlanned} onClick={()=>setShowPlanned(x=>!x)}>{showPlanned?"Hide roadmap":"Show planned tools"}</button></div>
    <div className="hub-toolbar"><label className="hub-search"><Search size={17}/><input type="search" aria-label="Search tools" placeholder="Find a tool…" value={query} onChange={e=>setQuery(e.target.value)}/>{query&&<button aria-label="Clear search" onClick={()=>setQuery("")}><X size={14}/></button>}</label><span><i className="hub-live-dot"/>Connected <i className="hub-planned-dot"/>Planned</span></div>
    {notice&&<p className="connections-notice" role="status">{notice}</p>}{error&&<p className="connections-error" role="alert">{error}</p>}
    <div className="hub-sections">{connectorSections.filter(s=>category==="all"||category===s.id).map((section,index)=>{const tools=section.tools.filter(t=>matches(t.name+" "+t.description)&&(showPlanned||query.length>0||available(t.name)));const devMatch=section.id==="dev"&&["GitHub","Vercel","Supabase","Railway","n8n"].some(matches);const mailMatch=section.id==="business"&&["Veltra Mail","Gmail"].some(matches);if(!tools.length&&!devMatch&&!mailMatch)return null;const Icon=icons[connectorSections.indexOf(section)];return <section key={section.id} className={`hub-section hub-section-${section.id}`} aria-labelledby={`hub-${section.id}`}><div className="hub-section-heading"><span><Icon size={17}/><h2 id={`hub-${section.id}`}>{section.name}</h2></span><p>{section.description}</p></div>
    {section.id==="dev"?<DeveloperConnections query={query} onCount={setDeveloperCount}>{tools.map(planned)}</DeveloperConnections>:<div className="hub-grid">{section.id==="business"&&["Veltra Mail","Gmail"].filter(matches).map(name=><article className="hub-card" key={name}><div className="hub-card-top"><ToolLogo name={name}/><span className={`hub-status ${connection?.connected?"live":""}`}>{connection?.connected?"Connected":connection?"Available":error?"Unavailable":"Loading…"}</span></div><h3>{name}</h3><p>{name==="Veltra Mail"?"Your full Mail workspace, beside Chat.":"Email, drafts and follow-ups through Veltra Mail."}</p>{connection?.connected?<Link className="hub-card-button" href="/?canvas=mail">Open Mail <ArrowUpRight size={13}/></Link>:<a className="hub-card-button" href="#google-connector">Connect Google <ArrowUpRight size={13}/></a>}</article>)}{tools.map(planned)}</div>}
    </section>;})}</div>
    {query&&!connectorSections.some(s=>(category==="all"||category===s.id)&&(s.tools.some(t=>matches(t.name+" "+t.description))||s.id==="dev"&&["GitHub","Vercel","Supabase","Railway","n8n"].some(matches)||s.id==="business"&&["Veltra Mail","Gmail"].some(matches)))&&<div className="hub-no-results"><Search size={25}/><h2>No tools found</h2><p>Try a different name or choose another section.</p><button onClick={()=>{setQuery("");setCategory("all");}}>Show all tools</button></div>}
    <section className="hub-google" id="google-connector" aria-labelledby="google-title"><ToolLogo name="Google Workspace"/><div><h2 id="google-title">Google Workspace</h2><p>{connection?.connected?connection.mailbox?.email??"Mail connected":"Connect Google to use Veltra Mail."}</p><small>Mail access only. Docs, Sheets and Calendar need separate setup.</small></div><button disabled={busy||!connection} onClick={()=>void connect(Boolean(connection?.connected))}>{busy?"Please wait…":connection?.connected?"Disconnect Mail":"Connect Google"}</button></section>
    <footer className="hub-footer"><p>Disconnecting Mail from Chat keeps standalone Mail available.</p><div><Link href="/docs">Help</Link><Link href="/privacy">Privacy</Link><Link href="/eula">Terms</Link></div></footer>
    </section></div>
    {detail&&<dialog ref={detailDialog} className="hub-detail-dialog" onCancel={()=>setDetail(null)} aria-labelledby="tool-detail-title"><div className="hub-detail-top"><ToolLogo name={detail.name}/><button aria-label="Close tool details" onClick={()=>setDetail(null)}><X size={18}/></button></div><span className="hub-status">{detail.name==="Veltra Gather"?"Private preview":"Planned"} {detail.kind==="workspace"?"workspace":detail.kind==="mcp"?"MCP connection":"integration"}</span><h2 id="tool-detail-title">{detail.name}</h2><p>{detail.description}</p><div className="hub-detail-note">{detail.name==="Veltra Gather"?"The read-only MCP adapter is prepared for owned events, tasks, vendors, budgets and timelines. Backend authorization and the customer workspace must be completed before use. No Zee client records or credentials have been copied.":"This tool is on Veltra’s connection roadmap. It is not connected or available yet. We’ll enable account authorization once its integration is ready."}</div><button className="hub-detail-done" onClick={()=>setDetail(null)}>Back to tools</button></dialog>}
  </main>;
}

