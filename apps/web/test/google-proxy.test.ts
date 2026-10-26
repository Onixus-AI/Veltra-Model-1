import {test} from 'node:test';
import assert from 'node:assert/strict';
import {NextRequest} from 'next/server';
import {GET,POST,DELETE} from '../app/api/google/[...path]/route';
test('Google proxy restricts routes/methods, forwards only to configured backend and rejects agent access',async t=>{
 const old=process.env.VELTRA_MAIL_URL;process.env.VELTRA_MAIL_URL='https://mail.test';let calls=0;
 t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{calls++;const url=new URL(String(input));assert.equal(url.origin,'https://mail.test');assert.equal(new Headers(init?.headers).get('authorization'),'Bearer user-token');return Response.json({connected:true});});
 const call=(path:string,method='GET',auth=true,task=false)=>({GET,POST,DELETE}[method as 'GET'|'POST'|'DELETE'])(new NextRequest('https://chat.test/api/google/'+path,{method,headers:{...(auth?{authorization:'Bearer user-token'}:{}),...(task?{'x-veltra-task':'task'}:{})}}),{params:Promise.resolve({path:path.split('?')[0].split('/')})});
 try{
  assert.equal((await call('status','GET',false)).status,401);assert.equal((await call('status','POST')).status,405);assert.equal((await call('oauth/callback')).status,404);assert.equal((await call('file','GET',true,true)).status,403);assert.equal(calls,0);
  assert.equal((await call('status')).status,200);assert.equal((await call('files?q=Proposal')).status,200);assert.equal((await call('disconnect','DELETE')).status,200);assert.equal((await call('editor?id=doc')).status,200);assert.equal((await call('save','POST')).status,200);assert.equal((await call('save','GET')).status,405);assert.equal((await call('save','POST',true,true)).status,403);assert.equal(calls,5);
 }finally{if(old===undefined)delete process.env.VELTRA_MAIL_URL;else process.env.VELTRA_MAIL_URL=old;}
});
