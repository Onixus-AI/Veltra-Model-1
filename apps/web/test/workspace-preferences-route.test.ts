import test from 'node:test';
import assert from 'node:assert/strict';
import {GET,PUT} from '../app/api/workspace/preferences/route';
import {defaultSettings,preferenceKeys} from '../lib/workspace-settings';
test('the route verifies and updates the captured bearer identity without admin credentials',async t=>{
 const priorUrl=process.env.NEXT_PUBLIC_SUPABASE_URL,priorKey=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://preferences-fixture.supabase.co';process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='fixture-public-key';
 const records=new Map([['alice',{id:'alice',is_anonymous:false,user_metadata:{unchanged:'keep'}}],['bob',{id:'bob',is_anonymous:false,user_metadata:{unchanged:'keep'}}]]);
 const writes:{token:string;data:Record<string,unknown>}[]=[];
 const mock=t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
  assert.equal(String(input),'https://preferences-fixture.supabase.co/auth/v1/user');const headers=new Headers(init?.headers),token=headers.get('authorization')?.replace('Bearer ','')||'';
  assert.equal(headers.get('apikey'),'fixture-public-key');
  if(!records.has(token))return Response.json({message:'Invalid token'},{status:401});
  if(init?.method==='PUT'){const body=JSON.parse(String(init.body));assert.deepEqual(Object.keys(body),['data']);writes.push({token,data:body.data});return Response.json({...records.get(token),user_metadata:{...records.get(token)!.user_metadata,...body.data}});}
  return Response.json(records.get(token));
 });
 const request=(token:string,expected=token)=>new Request('https://workspace.example/api/workspace/preferences',{method:'PUT',headers:{Authorization:'Bearer '+token},body:JSON.stringify({userId:expected,section:'layout',value:{...defaultSettings().layout,name:'Alice layout'}})});
 try{
  assert.equal((await PUT(request('alice'))).status,200);assert.equal(writes[0].token,'alice');assert.deepEqual(Object.keys(writes[0].data),[preferenceKeys.layout]);
  assert.equal((await PUT(request('bob','alice'))).status,409);
  assert.equal((await PUT(request('expired'))).status,401);
  assert.equal((await PUT(request('veltra_sk_fixture'))).status,401);assert.equal(writes.length,1);
  const get=await GET(new Request('https://workspace.example/api/workspace/preferences',{headers:{Authorization:'Bearer bob'}}));assert.equal((await get.json()).userId,'bob');
 }finally{mock.mock.restore();if(priorUrl===undefined)delete process.env.NEXT_PUBLIC_SUPABASE_URL;else process.env.NEXT_PUBLIC_SUPABASE_URL=priorUrl;if(priorKey===undefined)delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY=priorKey;}
});
