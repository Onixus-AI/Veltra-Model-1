import {test} from 'node:test';
import assert from 'node:assert/strict';
import {NextRequest} from 'next/server';
import {GET,POST,DELETE} from '../app/api/google-calendar/[...path]/route';
test('Google Calendar proxy restricts routes/methods, forwards only to the configured backend and rejects agent access',async t=>{
 const old=process.env.VELTRA_MAIL_URL;process.env.VELTRA_MAIL_URL='https://mail.test/';const seen:string[]=[];
 t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{const url=new URL(String(input));assert.equal(url.origin,'https://mail.test');assert.equal(new Headers(init?.headers).get('authorization'),'Bearer user-token');seen.push(`${init?.method} ${url.pathname}${url.search}`);return Response.json({ok:true});});
 const call=(path:string,method='GET',auth=true,task=false,body?:string)=>({GET,POST,DELETE}[method as 'GET'|'POST'|'DELETE'])(new NextRequest('https://chat.test/api/google-calendar/'+path,{method,body,headers:{...(auth?{authorization:'Bearer user-token'}:{}),...(task?{'x-veltra-task':'task'}:{})}}),{params:Promise.resolve({path:path.split('?')[0].split('/')})});
 try{
  assert.equal((await call('status','GET',false)).status,401);
  assert.equal((await call('commit','GET')).status,405);
  for(const blocked of ['oauth/callback','oauth/start','constructor','__proto__','events/x'])assert.equal((await call(blocked)).status,404,blocked);
  for(const route of ['propose','commit','start','sync'])assert.equal((await call(route,'POST',true,true,'{}')).status,403,`chat task cannot ${route}`);
  assert.equal((await call('events','GET',true,true)).status,403);
  assert.equal(seen.length,0);
  assert.equal((await call('status')).status,200);
  assert.equal((await call('events?calendar=primary&from=2026-11-01')).status,200);
  assert.equal((await call('commit','POST',true,false,'{"ticket":"t","confirmed":true}')).status,200);
  assert.equal((await call('disconnect','DELETE')).status,200);
  assert.deepEqual(seen,['GET /chat/google/calendar/','GET /chat/google/calendar/events?calendar=primary&from=2026-11-01','POST /chat/google/calendar/commit','DELETE /chat/google/calendar/']);
  delete process.env.VELTRA_MAIL_URL;
  assert.equal((await call('status')).status,503);
 }finally{if(old===undefined)delete process.env.VELTRA_MAIL_URL;else process.env.VELTRA_MAIL_URL=old;}
});
