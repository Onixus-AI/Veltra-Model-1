import test from 'node:test';
import assert from 'node:assert/strict';
import {dom} from './helpers/dom-global';
import './helpers/react-global';
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import Connections from '../app/settings/connections/page';
import {rememberBusiness} from '../lib/workspace-business';

test('Connections retains business context, returns to Overview and shows Signal status for the selected business',async t=>{
 dom.reconfigure({url:'https://workspace.test/settings/connections?workspace=business-a&mode=business'});
 Object.assign(globalThis,{location:dom.window.location,history:dom.window.history,CustomEvent:dom.window.CustomEvent,self:dom.window});
 const values=new Map<string,string>();
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v)}});
 Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:()=>null,removeItem:()=>{}}});
 process.env.NEXT_PUBLIC_SUPABASE_URL='';process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='';
 t.mock.method(globalThis,'fetch',async(input:unknown)=>{
  if(input==='/api/workspace/signal')return Response.json({connections:[{workspace_id:'business-a'}]});
  if(input==='/api/crm/connection'||input==='/api/mail/link')return Response.json({connected:true});
  if(input==='/api/bee/status')return Response.json({connected:false,tools:[]});
  return Response.json({error:'Not connected in fixture'},{status:503});
 });
 const host=document.body.appendChild(document.createElement('div')),root=createRoot(host);
 t.after(()=>{act(()=>root.unmount());host.remove();});
 await act(async()=>root.render(createElement(Connections)));
 function check(business:string){
  const links=Array.from(host.querySelectorAll('a')).filter(link=>/Open Website Builder|Open Google files|Open Google Calendar|Open CRM|Open Mail|Open Signal|Connect Signal|Connection settings|Back to Workspace/.test(link.textContent??''));
  assert.ok(links.length>=8);
  for(const link of links)assert.equal(new URL(link.href).searchParams.get('workspace'),business,link.textContent??'link');
  const back=host.querySelector('.hub-back') as HTMLAnchorElement;assert.equal(new URL(back.href).pathname,'/workspace');
 }
 check('business-a');assert.match(host.textContent!,/Business linked/);
 const personal=Array.from(host.querySelectorAll('.connector-mode-pills button')).find(button=>button.textContent==='Personal') as HTMLButtonElement;
 await act(async()=>personal.click());assert.equal(new URL(location.href).searchParams.get('workspace'),'business-a');
 const businessMode=Array.from(host.querySelectorAll('.connector-mode-pills button')).find(button=>button.textContent==='Business') as HTMLButtonElement;
 await act(async()=>businessMode.click());
 await act(async()=>rememberBusiness('business-b'));
 check('business-b');assert.equal(host.textContent!.includes('Business linked'),false,'another business link must not count for the selected business');
});
