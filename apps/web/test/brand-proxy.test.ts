import {test} from 'node:test';
import assert from 'node:assert/strict';
import {NextRequest} from 'next/server';
import {GET,POST} from '../app/api/brand/[...path]/route';
test('Brand proxy restricts routes and methods and retains authenticated attachment downloads',async t=>{
 const old=process.env.VELTRA_MAIL_URL;process.env.VELTRA_MAIL_URL='https://mail.test';let calls=0;
 t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{calls++;const url=new URL(String(input));assert.equal(url.origin,'https://mail.test');assert.ok(url.pathname.startsWith('/chat/brand/'));assert.equal(new Headers(init?.headers).get('authorization'),'Bearer user-token');return new Response('file data',{headers:{'content-type':'text/plain','content-disposition':'attachment; filename="guide.txt"'}});});
 const call=(path:string,method='GET',auth=true,task=false)=>(method==='GET'?GET:POST)(new NextRequest('https://chat.test/api/brand/'+path,{method,headers:{...(auth?{authorization:'Bearer user-token'}:{}),...(task?{'x-veltra-task':'task'}:{})}}),{params:Promise.resolve({path:path.split('?')[0].split('/')})});
 try{assert.equal((await call('files','GET',false)).status,401);assert.equal((await call('files','POST')).status,405);assert.equal((await call('../other')).status,404);assert.equal((await call('upload','POST',true,true)).status,403);assert.equal(calls,0);const response=await call('download?id=123');assert.equal(await response.text(),'file data');assert.match(response.headers.get('content-disposition')!,/attachment/);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');}finally{if(old===undefined)delete process.env.VELTRA_MAIL_URL;else process.env.VELTRA_MAIL_URL=old;}
});
