import test from 'node:test';
import assert from 'node:assert/strict';
import {dom} from './helpers/dom-global';
import './helpers/react-global';
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import Connections from '../app/settings/connections/page';
import {rememberBusiness} from '../lib/workspace-business';

const settle=()=>new Promise(resolve=>setTimeout(resolve,0));

test('Connections lists every connector with its live status and one action, inside the selected business',async t=>{
 dom.reconfigure({url:'https://workspace.test/settings/connections?workspace=business-a'});
 Object.assign(globalThis,{location:dom.window.location,history:dom.window.history,CustomEvent:dom.window.CustomEvent,self:dom.window});
 const values=new Map<string,string>();
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v)}});
 Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}}});
 process.env.NEXT_PUBLIC_SUPABASE_URL='';process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='';
 t.mock.method(globalThis,'fetch',async(input:unknown)=>{
  switch(input){
   case '/api/workspace/signal':return Response.json({connections:[{workspace_id:'business-a'}]});
   case '/api/crm/connection':return Response.json({connected:true,available:true,has_workspace:true});
   case '/api/mail/link':return Response.json({connected:true,mailboxes:['info@onixus.xyz']});
   case '/api/mail/onyx-link':return Response.json({connected:true,mailbox:{email:'info@onixus.xyz'}});
   case '/api/google/status':return Response.json({configured:true,connected:true,account:{email:'info@onixus.xyz'}});
   case '/api/google-calendar/status':return Response.json({configured:true,connected:false});
   case '/api/connections/status':return Response.json({connections:[{provider:'github',connected:true,configured:true,account:{},selection:{name:'Veltra-Model-1'}},{provider:'vercel',connected:true,configured:true,account:{},selection:{}},{provider:'supabase',connected:false,configured:true,account:{},selection:{}},{provider:'n8n',connected:false,configured:true,account:{},selection:{}}]});
   case '/api/integrations/status':return Response.json({firecrawl:{connected:true}});
   case '/api/bee/status':return Response.json({connected:false,tools:[]});
   default:return Response.json({error:'Not connected in fixture'},{status:503});
  }
 });
 const host=document.body.appendChild(document.createElement('div')),root=createRoot(host);
 t.after(()=>{act(()=>root.unmount());host.remove();});
 await act(async()=>{root.render(createElement(Connections));await settle();await settle();});
 const card=(name:string)=>Array.from(host.querySelectorAll('.cx-card')).find(c=>c.querySelector('h3')?.textContent===name) as HTMLElement;
 const state=(name:string)=>card(name)?.dataset.state;

 assert.equal(host.querySelectorAll('.cx-card').length,13,'every connector is listed');
 assert.equal(state('Gmail'),'connected');assert.match(card('Gmail').textContent!,/info@onixus\.xyz/);
 assert.equal(state('Onixus Mail'),'connected');assert.match(card('Onixus Mail').textContent!,/Use in Onyx/);
 assert.equal(state('Firecrawl'),'connected');assert.match(card('Firecrawl').textContent!,/Included with Onixus/);
 assert.equal(state('GitHub'),'connected');assert.match(card('GitHub').textContent!,/Veltra-Model-1/);
 assert.equal(state('Signal'),'connected');
 assert.equal(state('Shopify'),'unavailable','a service that does not answer is never shown as connected');
 for(const name of ['Google Calendar','Supabase','LiveAskew / Bee']){
  assert.equal(state(name),'available',name);
  assert.ok(Array.from(card(name).querySelectorAll('button')).some(b=>b.textContent?.trim()==='Connect'),`${name} has a Connect button`);
 }
 assert.ok(card('n8n').querySelector('input[aria-label="Your n8n address"]'),'n8n asks for its address before connecting');
 assert.match(host.querySelector('.cx-summary')!.textContent!,/7 of 13 connected/);

 const back=host.querySelector('.cx-back') as HTMLAnchorElement;
 assert.equal(new URL(back.href).pathname,'/workspace');assert.equal(new URL(back.href).searchParams.get('workspace'),'business-a');
 const crmOpen=Array.from(card('Onixus CRM').querySelectorAll('a')).find(a=>/Open/.test(a.textContent??'')) as HTMLAnchorElement;
 assert.equal(new URL(crmOpen.href).searchParams.get('workspace'),'business-a');

 const connected=Array.from(host.querySelectorAll('.cx-segments button')).find(b=>b.textContent==='Connected') as HTMLButtonElement;
 await act(async()=>connected.click());
 assert.ok(Array.from(host.querySelectorAll('.cx-card')).every(c=>(c as HTMLElement).dataset.state==='connected'));

 await act(async()=>{rememberBusiness('business-b');await settle();await settle();});
 const all=Array.from(host.querySelectorAll('.cx-segments button')).find(b=>b.textContent==='All') as HTMLButtonElement;
 await act(async()=>all.click());
 assert.equal(state('Signal'),'available','another business link must not count for the selected business');
});
