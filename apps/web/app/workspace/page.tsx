'use client';

import Link from 'next/link';
import {useEffect,useState} from 'react';
import {gatewayAuthorizationHeaders} from '@/lib/client-session';
import './workspace.css';

type State='loading'|'connected'|'available'|'unavailable';
type Space={id:string;name:string};
export default function WorkspaceHome(){
 const [spaces,setSpaces]=useState<Space[]>([]),[workspace,setWorkspace]=useState('');
 const [crm,setCrm]=useState<State>('loading'),[mail,setMail]=useState<State>('loading'),[error,setError]=useState('');
 useEffect(()=>{let active=true;async function load(){
  try{const headers=await gatewayAuthorizationHeaders();
   const results=await Promise.allSettled(['/api/crm/workspaces','/api/crm/connection','/api/mail/link'].map(async url=>{const response=await fetch(url,{headers,cache:'no-store'});if(!response.ok)throw new Error('Connection unavailable');return response.json();}));
   if(!active)return;
   const [memberships,crmResult,mailResult]=results;
   if(memberships.status==='fulfilled'){const owned:Space[]=memberships.value.workspaces??[];setSpaces(owned);if(owned.length===1)setWorkspace(owned[0].id);}else setError('Your business workspaces could not load. Refresh to try again.');
   setCrm(crmResult.status==='fulfilled'?(crmResult.value.connected?'connected':'available'):'unavailable');
   setMail(mailResult.status==='fulfilled'?(mailResult.value.connected?'connected':'available'):'unavailable');
  }catch{if(active){setError('Your connections could not load. Refresh to try again.');setCrm('unavailable');setMail('unavailable');}}
 }void load();return()=>{active=false;};},[]);
 const query=workspace?'&workspace='+encodeURIComponent(workspace):'';
 const chat=workspace?'/?crm_workspace='+encodeURIComponent(workspace):'/?view=chat';
 const label=(state:State)=>({loading:'Checking connection…',connected:'Connected',available:'Setup available',unavailable:'Check connection'}[state]);
 return <main className="suite-home">
  <header className="suite-header"><Link href="/workspace" className="suite-brand"><img src="/veltra-logo.png" alt="Veltra"/><span>Workspace</span></Link><nav aria-label="Account"><Link href="/settings/connections">Connections</Link><Link href="/settings">Settings</Link></nav></header>
  <section className="suite-intro"><div><h1>Your work, together.</h1><p>Conversations, customers and email in one Veltra workspace.</p></div><label>Business workspace<select value={workspace} onChange={event=>setWorkspace(event.target.value)}><option value="">Choose a business</option>{spaces.map(space=><option key={space.id} value={space.id}>{space.name}</option>)}</select></label></section>
  {error&&<p role="alert">{error}</p>}
  <section className="suite-products" aria-label="Veltra products">
   <article><span className="suite-status">Included in your workspace</span><h2>Chat</h2><p>Direct the work. Keep conversations, customer context and supported actions together.</p><Link className="suite-open" href={chat}>Open Chat <span aria-hidden="true">↗</span></Link></article>
   <article><span className="suite-status" role="status">{label(mail)}</span><h2>Mail</h2><p>Handle your inbox, logistics quotes and customer follow-ups through your connected mailbox.</p><Link className="suite-open" href={mail==='connected'?'/?canvas=mail':'/settings/connections#google-connector'}>{mail==='connected'?'Open Mail':'Set up Mail'} <span aria-hidden="true">↗</span></Link><small>Mail uses your connected mailbox. Choosing a business here does not change its campaign connection.</small></article>
   <article><span className="suite-status" role="status">{label(crm)}</span><h2>CRM</h2><p>Discover companies, review published contacts and manage customer relationships.</p><Link className="suite-open" href={crm==='connected'?'/?canvas=crm'+query:'/settings/connections?tool=crm'}>{crm==='connected'?'Open CRM':'Set up CRM'} <span aria-hidden="true">↗</span></Link></article>
  </section>
  <section className="suite-connectors" aria-labelledby="connectors-title"><div><h2 id="connectors-title">Your tools, connected.</h2><p>Bring the accounts you use into Veltra. Review each connection’s access and use supported tools from Chat.</p></div><Link className="suite-open" href="/settings/connections">Manage connectors <span aria-hidden="true">↗</span></Link></section>
  <footer>Connected services keep their existing permissions and approval rules. <Link href="/settings/connections">Manage access</Link></footer>
 </main>;
}
