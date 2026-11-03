import test from 'node:test';
import assert from 'node:assert/strict';
import {dom} from './helpers/dom-global';
import './helpers/react-global';
import './helpers/css-global';
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import Overview from '../app/workspace/page';
import BrandFolder from '../components/brand-folder';
function globals(){
 dom.reconfigure({url:'https://workspace.test/workspace?workspace=business-a'});
 const values=new Map<string,string>();Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)}});
 Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:()=>null}});
 Object.assign(globalThis,{self:dom.window,CustomEvent:dom.window.CustomEvent});
 process.env.NEXT_PUBLIC_SUPABASE_URL='';process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='';
}
test('Overview keeps selected business on every tool and connection link, including after business changes',async t=>{
 globals();
 t.mock.method(globalThis,'fetch',async(input:unknown)=>{
  const url=String(input);
  if(url==='/api/crm/workspaces')return Response.json({workspaces:[{id:'business-a',name:'Mobile mechanic'},{id:'business-b',name:'Repair shop'}]});
  if(url==='/api/crm/connection'||url==='/api/mail/link')return Response.json({connected:false});
  return Response.json({error:'Fixture summary unavailable'},{status:503});
 });
 const host=document.body.appendChild(document.createElement('div')),root=createRoot(host);t.after(()=>{act(()=>root.unmount());host.remove();});
 await act(async()=>root.render(createElement(Overview)));
 const check=(business:string)=>{
  const links=host.querySelectorAll('.suite-product');assert.equal(links.length,8);
  for(const link of links){const url=new URL((link as HTMLAnchorElement).href);assert.equal(url.searchParams.get('workspace'),business,link.textContent??'tool');}
  const connections=host.querySelector('footer a') as HTMLAnchorElement;assert.equal(new URL(connections.href).searchParams.get('workspace'),business);
  const crm=Array.from(links).find(link=>link.querySelector('h2')?.textContent==='CRM') as HTMLAnchorElement;
  assert.equal(new URL(crm.href).searchParams.get('tool'),'crm');assert.equal(new URL(crm.href).pathname,'/settings/connections');
 };
 check('business-a');
 const select=host.querySelector('select') as HTMLSelectElement;
 await act(async()=>{select.value='business-b';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
 check('business-b');
});
test('Brand files separates loading, failure and empty states, retries, and retains business on return links',async t=>{
 globals();let resolve!:(response:Response)=>void;let response=new Promise<Response>(done=>{resolve=done;});
 t.mock.method(globalThis,'fetch',async()=>response);
 const host=document.body.appendChild(document.createElement('div')),root=createRoot(host);t.after(()=>{act(()=>root.unmount());host.remove();});
 await act(async()=>root.render(createElement(BrandFolder)));
 assert.match(host.querySelector('[role=status]')!.textContent!,/Loading brand files/);assert.equal(host.textContent!.includes('Upload your first'),false);
 await act(async()=>resolve(Response.json({error:'Files unavailable'},{status:503})));
 assert.match(host.querySelector('[role=alert]')!.textContent!,/Files unavailable/);assert.equal(host.textContent!.includes('Upload your first'),false);
 response=new Promise<Response>(done=>{resolve=done;});
 await act(async()=>{(host.querySelector('[role=alert] button') as HTMLButtonElement).click();});
 assert.match(host.querySelector('[role=status]')!.textContent!,/Loading brand files/);
 await act(async()=>resolve(Response.json({files:[]})));
 assert.equal(host.querySelector('[role=alert]'),null);assert.equal(host.querySelector('[role=status]'),null);assert.match(host.textContent!,/Upload your first brand file/);
 for(const link of host.querySelectorAll('nav a'))assert.equal(new URL((link as HTMLAnchorElement).href).searchParams.get('workspace'),'business-a');
 assert.match(host.textContent!,/Private files for your signed-in account/);
});
test('Brand file loading has a deadline and a usable timeout error',async t=>{
 globals();
 t.mock.method(globalThis,'fetch',async(_input:unknown,options?:RequestInit)=>{assert.ok(options?.signal instanceof AbortSignal);const error=Error('fixture timeout');error.name='TimeoutError';throw error;});
 const host=document.body.appendChild(document.createElement('div')),root=createRoot(host);t.after(()=>{act(()=>root.unmount());host.remove();});
 await act(async()=>root.render(createElement(BrandFolder)));
 assert.match(host.querySelector('[role=alert]')!.textContent!,/took too long to load/);assert.equal(host.querySelector('[role=status]'),null);assert.equal(host.textContent!.includes('Upload your first'),false);
});

test('Overview shows one actionable business-loading failure instead of a duplicate empty state',async t=>{
 globals();
 t.mock.method(globalThis,'fetch',async()=>Response.json({error:'Unavailable'},{status:503}));
 const host=document.body.appendChild(document.createElement('div')),root=createRoot(host);
 t.after(()=>{act(()=>root.unmount());host.remove();});
 await act(async()=>root.render(createElement(Overview)));
 assert.equal(host.querySelectorAll('[role=alert]').length,1);
 assert.equal(host.querySelector('.suite-empty'),null);
 assert.match(host.querySelector('[role=alert]')!.textContent!,/Check Connections/);
 assert.match(host.querySelector('[role=alert]')!.textContent!,/Open Onyx/);
 assert.equal((host.querySelector('[role=alert] button') as HTMLButtonElement).disabled,false);
});
