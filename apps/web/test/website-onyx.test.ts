import test from 'node:test';
import assert from 'node:assert/strict';
import {dom} from './helpers/dom-global';
import './helpers/react-global';
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import WebsiteOnyx from '../components/website-onyx';
const id='484ab0df-292c-4b50-9fd3-0be33eaef4b0';
for(const status of ['failed','interrupted'])test(status+' website preserves the current site and distinguishes used credits from reservations',async t=>{
 dom.reconfigure({url:'https://workspace.test/websites?workspace=mechanic&run='+id});
 Object.assign(globalThis,{location:dom.window.location,history:dom.window.history,self:dom.window});
 process.env.NEXT_PUBLIC_SUPABASE_URL='';process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='';
 let installed=false;const calls:string[]=[];
 t.mock.method(globalThis,'fetch',async(input:unknown)=>{
  calls.push(String(input));
  if(input==='/api/account')return Response.json({credits_remaining:123456});
  assert.equal(input,'/api/agent-runs/'+id);
  return Response.json({id,status,stage:'finished',credits_reserved:20000,credits_used:11972,error:'The website response was incomplete.',state:status==='failed'?{receipts:[{role:'planner',credits:972},{role:'coder',credits:11000,prompt_tokens:7000,completion_tokens:4000}]}:{artifacts:{files:[{path:'index.html',content:'<html>unfinished'}]}}});
 });
 const host=document.body.appendChild(document.createElement('div')),root=createRoot(host);
 t.after(()=>{act(()=>root.unmount());host.remove();});
 await act(async()=>root.render(createElement(WebsiteOnyx,{source:'<html><body>Keep my site</body></html>',onResult:()=>{installed=true;},onBusy:()=>{}})));
 assert.equal(installed,false);assert.match(host.textContent!,/11,972 credits used/);
 assert.match(host.textContent!,/123,456 credits/);assert.ok(calls.includes('/api/account'));
 if(status==='failed'){
  assert.match(host.textContent!,/8,028 unused credits released/);assert.match(host.textContent!,/7,000 input tokens/);
 }else{
  assert.match(host.textContent!,/reservation may still be held/);assert.equal(host.textContent!.includes('unused credits released'),false);
  assert.match(host.textContent!,/does not include a per-step breakdown/);
 }
});
