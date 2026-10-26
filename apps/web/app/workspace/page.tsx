'use client';

import Link from 'next/link';
import {useEffect,useState,type FormEvent} from 'react';
import {ArrowRight,ArrowUpRight,MessageSquare,Mail,Users,Search,CheckCheck,Plug,Settings2,Sparkles,ArrowUp,RefreshCw} from 'lucide-react';
import {mailHealthSummary,type MailHealth} from '@/lib/mail-health';
import OperationsCenter from '@/components/crm/operations-center';
import {gatewayAuthorizationHeaders} from '@/lib/client-session';
import './workspace.css';

type State='loading'|'connected'|'available'|'unavailable';
type Space={id:string;name:string};
const contextKey='veltra-home-business';
export default function WorkspaceHome(){
 const [spaces,setSpaces]=useState<Space[]>([]),[workspace,setWorkspace]=useState('');
 const [crm,setCrm]=useState<State>('loading'),[mail,setMail]=useState<State>('loading'),[error,setError]=useState('');
 const [mailRuntime,setMailRuntime]=useState<MailHealth|null>(null);
 const [prompt,setPrompt]=useState(''),[refresh,setRefresh]=useState(0),[loading,setLoading]=useState(true);
 useEffect(()=>{let active=true;const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
 async function load(){setLoading(true);setError('');
  try{const headers=await gatewayAuthorizationHeaders();
   const results=await Promise.allSettled(['/api/crm/workspaces','/api/crm/connection','/api/mail/link'].map(async url=>{const response=await fetch(url,{headers,cache:'no-store',signal:controller.signal});if(!response.ok)throw new Error('Connection unavailable');return response.json();}));
   if(!active)return;
   const [memberships,crmResult,mailResult]=results;
   if(memberships.status==='fulfilled'){const owned:Space[]=memberships.value.workspaces??[];setSpaces(owned);let saved='';try{saved=localStorage.getItem(contextKey)??'';}catch{}setWorkspace(current=>owned.some(s=>s.id===current)?current:owned.find(s=>s.id===saved)?.id??owned[0]?.id??'');}else{setSpaces([]);setWorkspace('');setError('Business workspaces could not load. You can still open Chat or check Connections.');}
   setCrm(crmResult.status==='fulfilled'?(crmResult.value.connected?'connected':'available'):'unavailable');
   setMailRuntime(mailResult.status==='fulfilled'?mailResult.value:null);
   setMail(mailResult.status==='fulfilled'?(mailResult.value.connected?'connected':'available'):'unavailable');
  }catch{if(active){setError('Connections could not load. Try again or open Connections.');setCrm('unavailable');setMail('unavailable');}}
  finally{clearTimeout(timeout);if(active)setLoading(false);}
 }void load();return()=>{active=false;clearTimeout(timeout);controller.abort();};},[refresh]);
 useEffect(()=>{let active=true;const poll=setInterval(()=>{void gatewayAuthorizationHeaders().then(headers=>fetch('/api/mail/link',{headers,cache:'no-store',signal:AbortSignal.timeout(10000)})).then(async response=>{if(!response.ok)throw Error('Unavailable');const data=await response.json();if(active){setMail(data.connected?'connected':'available');setMailRuntime(data);}}).catch(()=>{if(active){setMail('unavailable');setMailRuntime(null);}});},30000);return()=>{active=false;clearInterval(poll);};},[]);
 function changeWorkspace(value:string){setWorkspace(value);try{localStorage.setItem(contextKey,value);}catch{}}
 const context=workspace?'&crm_workspace='+encodeURIComponent(workspace):'';
 const chat='/?view=chat&mode=work'+context;
 const crmUrl=(view='Overview')=>'/crm?view='+encodeURIComponent(view)+(workspace?'&workspace='+encodeURIComponent(workspace):'');
 function begin(event:FormEvent){event.preventDefault();if(prompt.trim())window.location.assign(chat+'&prompt='+encodeURIComponent(prompt.trim()));}
 const label=(state:State)=>({loading:'Checking…',connected:'Connected',available:'Ready to connect',unavailable:'Connection needs attention'}[state]);
 const mailHealth=mailHealthSummary(mailRuntime);
 const activeSpace=spaces.find(s=>s.id===workspace);
 return <main className="suite-home">
  <header className="suite-header"><Link href="/workspace" className="suite-brand"><img src="/veltra-logo.png" alt="Onixus Workspace"/><span>Onixus Workspace<small>Your business workspace</small></span></Link><nav aria-label="Account"><Link href="/settings/connections"><Plug size={16}/>Connections</Link><Link href="/settings" aria-label="Settings"><Settings2 size={18}/></Link></nav></header>
  <section className="suite-intro"><div><span className="suite-eyebrow"><span/>A little clarity. A lot of forward.</span><h1>Let’s move your<br/><em>business forward.</em></h1><p>One place to think, follow up, and get the next thing done.</p></div><label className="suite-business">Working in<select aria-label="Business workspace" disabled={loading||!spaces.length} value={workspace} onChange={event=>changeWorkspace(event.target.value)}><option value="">{loading?'Loading businesses…':'Choose a business'}</option>{spaces.map(space=><option key={space.id} value={space.id}>{space.name}</option>)}</select><small>{activeSpace?'Your overview follows this business.':'Choose a business to see its activity.'}</small></label></section>
  <section className="suite-start" aria-label="Start a task"><div className="suite-start-label"><Sparkles size={17}/><span>What would you like to work on?</span><span className="suite-start-tag">ONIXUS CHAT</span></div><form onSubmit={begin}><label className="suite-sr" htmlFor="home-task">Your task</label><textarea id="home-task" rows={2} maxLength={2000} value={prompt} onChange={event=>setPrompt(event.target.value)} placeholder="Plan my day, draft a follow-up, or help me think through an idea…"/><div className="suite-start-footer"><span>Opens in Chat. You review the message before sending.</span><button type="submit" disabled={!prompt.trim()}>Start in Chat <ArrowUp size={17}/></button></div></form></section>
  <nav className="suite-shortcuts" aria-label="Quick actions"><a href={crmUrl('Sources')}><Search size={15}/>Find prospects<ArrowUpRight size={13}/></a><a href={crmUrl('Automation')}><Mail size={15}/>Review outreach<ArrowUpRight size={13}/></a><a href={crmUrl('Customers')}><Users size={15}/>View customers<ArrowUpRight size={13}/></a><a href={chat+'&prompt='+encodeURIComponent('Help me review my priorities and plan my next steps.')}><CheckCheck size={15}/>Plan my day<ArrowUpRight size={13}/></a></nav>
  {error&&<div className="suite-error" role="alert"><span>{error}</span><button type="button" disabled={loading} onClick={()=>setRefresh(n=>n+1)}><RefreshCw size={14}/>Try again</button></div>}
  <section className="suite-products" aria-label="Your workspace tools">
   <a className="suite-product" href={chat}><span className="suite-tool-icon suite-chat"><img src="/brands/onixus-chat-icon-v2.png" alt="" width={32} height={32}/></span><div><h2>Chat</h2><p>Ideas into next steps.</p><span className="suite-status">Ready when you are</span></div><ArrowUpRight size={19}/></a>
   <a className="suite-product" href={mail==='connected'?'/?canvas=mail&mode=work'+context:'/settings/connections#google-connector'}><span className="suite-tool-icon suite-mail"><img src="/brands/onixus-mail-icon-v2.png" alt="" width={32} height={32}/></span><div><h2>Mail</h2><p>Your inbox. Your follow-through.</p><span className={'suite-status '+(mail==='connected'&&mailHealth.healthy?'connected':'')}>{mail==='connected'?mailHealth.label:label(mail)}</span></div><ArrowUpRight size={19}/></a>
   <a className="suite-product" href={crm==='connected'?crmUrl():'/settings/connections?tool=crm'}><span className="suite-tool-icon suite-crm"><img src="/brands/onixus-crm-icon-v2.png" alt="" width={32} height={32}/></span><div><h2>CRM</h2><p>Keep every relationship moving.</p><span className={'suite-status '+(crm==='connected'?'connected':'')}>{label(crm)}</span></div><ArrowUpRight size={19}/></a>
  </section>
  <p className="suite-scope-note">Business context applies to Chat and CRM. Mail opens your connected mailbox.</p>
  <div className="suite-section-title"><div><span className="suite-eyebrow">YOUR BUSINESS AT A GLANCE</span><h2>{activeSpace?`${activeSpace.name}, in motion.`:'See what needs your attention.'}</h2></div><a href={crmUrl()}>Open business overview <ArrowRight size={16}/></a></div>
  {workspace?<OperationsCenter workspace={workspace} onNavigate={view=>window.location.assign(crmUrl(view))}/>:<section className="suite-empty"><Users size={25}/><h3>{loading?'Opening your business overview…':'Your overview starts with a business.'}</h3><p>{error?'Retry loading your workspaces above.':'Choose a business above, or open CRM to create your first workspace.'}</p><a href="/crm">Open CRM <ArrowRight size={15}/></a></section>}
  <footer><span><span className="suite-footer-dot"/>Built around your work. Powered by Onixus.</span><Link href="/settings/connections">Manage connected tools <ArrowUpRight size={14}/></Link></footer>
 </main>;
}
