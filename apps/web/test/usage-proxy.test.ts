import {test} from 'node:test';
import assert from 'node:assert/strict';
import {NextRequest} from 'next/server';
import {GET} from '../app/api/usage/route';

test('usage proxy forwards selected month/day and signed-in authorization, not arbitrary filters',async t=>{
 const previous=process.env.AI_GATEWAY_URL;process.env.AI_GATEWAY_URL='https://usage-gateway.example.test';
 const mock=t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=new URL(String(input));
  assert.equal(url.origin,'https://usage-gateway.example.test');
  assert.equal(url.pathname,'/v1/usage');
  assert.equal(url.searchParams.get('month'),'2024-02');
  assert.equal(url.searchParams.get('day'),'2024-02-29');
  assert.equal(url.searchParams.has('organization_id'),false);
  assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer fixture-user');
  assert.equal(init?.cache,'no-store');
  return Response.json({month:'2024-02',selected_day:'2024-02-29'});
 });
 try{
  const result=await GET(new NextRequest('https://workspace.example/api/usage?month=2024-02&day=2024-02-29&organization_id=other-account',{headers:{Authorization:'Bearer fixture-user'}}));
  assert.equal(result.status,200);
  assert.deepEqual(await result.json(),{month:'2024-02',selected_day:'2024-02-29'});
 }finally{mock.mock.restore();if(previous===undefined)delete process.env.AI_GATEWAY_URL;else process.env.AI_GATEWAY_URL=previous;}
});
