'use client';
import BusinessNavigation from '@/components/workspace-business-nav';

import Link from 'next/link';
import {useEffect,useState} from 'react';
import {ArrowRight,ArrowUpRight,MessageSquare,Mail,Users,Search,CheckCheck,Plug,Settings2,Sparkles,ArrowUp,RefreshCw,CalendarDays,FolderOpen,Palette} from 'lucide-react';
import {mailHealthSummary,type MailHealth} from '@/lib/mail-health';
import BusinessSummary from '@/components/business-summary';
import {gatewayAuthorizationHeaders} from '@/lib/client-session';
import './workspace.css';

type State='loading'|'connected'|'available'|'unavailable';
type Space={id:string;name:string};
const contextKey='veltra-home-business';
export default function WorkspaceHome(){
 const [spaces,setSpaces]=useState<Space[]>([]),[workspace,setWorkspace]=useState('');
 const [crm,setCrm]=useState<State>('loading'),[mail,setMail]=useState<State>('loading'),[error,setError]=useState('');
 const [mailRuntime,setMailRuntime]=useState<MailHealth|null>(null);
 const [refresh,setRefresh]=useState(0),[loading,setLoading]=useState(true);
 useEffect(()=>{let active=true;const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
 async function load(){setLoading(true);setError('');
  try{const headers=await gatewayAuthorizationHeaders();
   const results=await Promise.allSettled(['/api/crm/workspaces','/api/crm/connection','/api/mail/link'].map(async url=>{const response=await fetch(url,{headers,cache:'no-store',signal:controller.signal});if(!response.ok)throw new Error('Connection unavailable');return response.json();}));
   if(!active)return;
   const [memberships,crmResult,mailResult]=results;
   if(memberships.status==='fulfilled'){const owned:Space[]=memberships.value.workspaces??[];setSpaces(owned);let saved='';try{saved=localStorage.getItem(contextKey)??'';}catch{}const requested=new URLSearchParams(location.search).get('workspace')||saved;setWorkspace(current=>owned.some(s=>s.id===current)?current:owned.find(s=>s.id===requested)?.id??owned[0]?.id??'');}else{setSpaces([]);setWorkspace('');setError('Business workspaces could not load. You can still open Chat or check Connections.');}
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

 const label=(state:State)=>({loading:'Checking…',connected:'Connected',available:'Ready to connect',unavailable:'Connection needs attention'}[state]);
 const mailHealth=mailHealthSummary(mailRuntime);
 const activeSpace=spaces.find(s=>s.id===workspace);
 return <main className="suite-home overview-home">
  <header className="suite-header"><Link href="/workspace" className="suite-brand"><img src="/veltra-logo.png" alt="Onixus Workspace"/><span>Onixus Workspace<small>Your business workspace</small></span></Link><BusinessNavigation workspace={workspace} current="overview"/></header>
  <section className="suite-intro"><div><h1>Business Overview</h1><p>Your results, priorities and team in one place.</p></div><label className="suite-business">Working in<select aria-label="Business workspace" disabled={loading||!spaces.length} value={workspace} onChange={event=>changeWorkspace(event.target.value)}><option value="">{loading?'Loading businesses…':'Choose a business'}</option>{spaces.map(space=><option key={space.id} value={space.id}>{space.name}</option>)}</select><small>{activeSpace?'Your overview follows this business.':'Choose a business to see its activity.'}</small></label></section>
  {workspace?<BusinessSummary key={workspace} workspace={workspace}/>:<section className="suite-empty"><h2>{loading?'Loading your business…':'Choose a business to see its overview.'}</h2><p>{error||'Your customers, pipeline, meetings and priorities will appear here.'}</p><a href="/crm">Open CRM</a></section>}
  {error&&<div className="suite-error" role="alert"><span>{error}</span><button type="button" disabled={loading} onClick={()=>setRefresh(n=>n+1)}><RefreshCw size={14}/>Try again</button></div>}
  <details className="suite-tool-directory"><summary>Open your workspace tools</summary><section className="suite-products" aria-label="Your workspace tools">
   <a className="suite-product" href={chat}><span className="suite-tool-icon suite-chat"><img src="/brands/onixus-chat-icon-v2.png" alt="" width={32} height={32}/></span><div><h2>Onyx</h2><p>Ask, plan and take reviewed actions across your tools.</p><span className="suite-status">Ready when you are</span></div><ArrowUpRight size={19}/></a>
   <a className="suite-product" href={mail==='connected'?'/?canvas=mail&mode=work'+context:'/settings/connections#google-connector'}><span className="suite-tool-icon suite-mail"><img src="/brands/onixus-mail-icon-v2.png" alt="" width={32} height={32}/></span><div><h2>Mail</h2><p>Read email, review replies and follow up.</p><span className={'suite-status '+(mail==='connected'&&mailHealth.healthy?'connected':'')}>{mail==='connected'?mailHealth.label:label(mail)}</span></div><ArrowUpRight size={19}/></a>
   <a className="suite-product" href={'/?canvas=signal&mode=business'+context}><span className="suite-tool-icon"><img src="/brands/onixus-signal-icon-v2.png" alt="" width={32} height={32}/></span><div><h2>Signal</h2><p>Review your business brand, content and publishing calendar.</p><span className="suite-status">Open linked Signal business</span></div><ArrowUpRight size={19}/></a>
   <a className="suite-product" href={crm==='connected'?crmUrl():'/settings/connections?tool=crm'}><span className="suite-tool-icon suite-crm"><img src="/brands/onixus-crm-icon-v2.png" alt="" width={32} height={32}/></span><div><h2>CRM</h2><p>Manage customers, deals and approved campaigns.</p><span className={'suite-status '+(crm==='connected'?'connected':'')}>{label(crm)}</span></div><ArrowUpRight size={19}/></a>
   <a className="suite-product" href={'/?canvas=calendar&mode=business'+context}><span className="suite-tool-icon"><CalendarDays size={26}/></span><div><h2>Calendar</h2><p>See meetings and review event changes before saving.</p><span className="suite-status">Open Calendar</span></div><ArrowUpRight size={19}/></a>
   <a className="suite-product" href="/websites"><span className="suite-tool-icon"><img src="/brands/onixus-websites-icon-v1.png" alt="" width={32} height={32}/></span><div><h2>Websites</h2><p>Design a site, edit sections and export your work.</p><span className="suite-status">Preview and export · AI uses credits</span></div><ArrowUpRight size={19}/></a>
   <a className="suite-product" href="/workspace/files"><span className="suite-tool-icon"><FolderOpen size={26}/></span><div><h2>Docs &amp; Sheets</h2><p>Find Drive files, write documents and edit spreadsheets.</p><span className="suite-status">Open files</span></div><ArrowUpRight size={19}/></a>
   <a className="suite-product" href="/workspace/brand"><span className="suite-tool-icon"><Palette size={26}/></span><div><h2>Brand files</h2><p>Keep your logos, images and brand documents together.</p><span className="suite-status">Open your private folder</span></div><ArrowUpRight size={19}/></a>
  </section>
  </details><p className="suite-scope-note">Business context applies to Onyx and CRM. Mail, Google files and brand files use your signed-in account; Calendar shows its linked business. Connections are checked when you open each tool.</p>
  <footer><span><span className="suite-footer-dot"/>Built around your work. Powered by Onixus.</span><Link href="/settings/connections">Manage connected tools <ArrowUpRight size={14}/></Link></footer>
 </main>;
}
