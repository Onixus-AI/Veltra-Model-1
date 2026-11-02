import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {dom} from './helpers/dom-global';
import './helpers/react-global';
import {act,createElement,useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {PathnameContext} from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import {browserSupabase} from '../lib/supabase';
import AuthGate from '../components/auth-gate';
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(a=>{resolve=a;});return {promise,resolve};}
const session=(id:string)=>({user:{id}});
function setup(t:TestContext){
 const storage=new Map<string,string>();Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value),removeItem:(key:string)=>storage.delete(key)}});
 Object.assign(globalThis,{self:dom.window});
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://auth-gate-test.supabase.co';process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='fixture-public';
 const client=browserSupabase()!;
 t.mock.method(globalThis,'fetch',async()=>Response.json({external:{google:false}}));
 const host=document.body.appendChild(document.createElement('div')),root=createRoot(host);
 t.after(async()=>{act(()=>root.unmount());host.remove();await client.auth.dispose();});
 return {client,host,root,text:()=>host.textContent??''};
}
test('account changes reset private tool state; token refresh preserves it; late initial sessions cannot revive it',async t=>{
 const {client,host,root,text}=setup(t);const initial=deferred<any>();let listener:Function=()=>{},mounts=0;
 t.mock.method(client.auth,'getSession',()=>initial.promise);
 t.mock.method(client.auth,'onAuthStateChange',(fn:Function)=>{listener=fn;return {data:{subscription:{unsubscribe(){}}}};});
 function PrivateTool(){const [draft,setDraft]=useState('Empty draft');useEffect(()=>{mounts++;},[]);return createElement('button',{onClick:()=>setDraft('Alice unfinished draft')},draft);}
 const render=(path:string)=>root.render(createElement(PathnameContext.Provider,{value:path},createElement(AuthGate,null,createElement(PrivateTool))));
 await act(async()=>render('/workspace'));assert.match(text(),/Opening your workspace/);
 await act(async()=>listener('SIGNED_IN',session('alice')));assert.equal(mounts,1);
 await act(async()=>{(host.querySelector('button') as HTMLButtonElement).click();});assert.equal(text(),'Alice unfinished draft');
 await act(async()=>listener('TOKEN_REFRESHED',session('alice')));assert.equal(mounts,1);assert.equal(text(),'Alice unfinished draft');
 await act(async()=>listener('SIGNED_IN',session('bob')));assert.equal(mounts,2);assert.equal(text(),'Empty draft');
 await act(async()=>initial.resolve({data:{session:session('alice')},error:null}));assert.equal(mounts,2,'stale initial Alice session cannot replace Bob');
 await act(async()=>listener('SIGNED_OUT',null));assert.match(text(),/Welcome back/);assert.equal(text().includes('Empty draft'),false);
 await act(async()=>listener('SIGNED_IN',session('alice')));assert.equal(mounts,3);assert.equal(text(),'Empty draft');
 const publicRead=deferred<any>();t.mock.method(client.auth,'getSession',()=>publicRead.promise);
 await act(async()=>render('/docs'));
 await act(async()=>listener('SIGNED_OUT',null));
 await act(async()=>publicRead.resolve({data:{session:session('alice')},error:null}));
 const protectedRead=deferred<any>();t.mock.method(client.auth,'getSession',()=>protectedRead.promise);
 await act(async()=>render('/workspace'));assert.match(text(),/Welcome back/,'sign-out on a public page is observed before returning to a protected tool');
});
test('a failed initial session read produces a sign-in error instead of an endless loader',async t=>{
 const {client,host,root,text}=setup(t);
 t.mock.method(client.auth,'getSession',async()=>{throw Error('session service unavailable');});
 t.mock.method(client.auth,'onAuthStateChange',()=>({data:{subscription:{unsubscribe(){}}}}));
 await act(async()=>root.render(createElement(PathnameContext.Provider,{value:'/workspace'},createElement(AuthGate,null,createElement('p',null,'Private tool')))));
 assert.match(host.querySelector('[role=alert]')!.textContent!,/session could not be verified/);assert.equal(text().includes('Private tool'),false);assert.equal(text().includes('Opening your workspace'),false);
});
