import test from 'node:test';
import assert from 'node:assert/strict';
import {cloudRunHeaders} from '../lib/business-team/cloud-run-auth';

const endpoint=new URL('https://onixus-hermes-pilot-302557357656.us-central1.run.app');
const env={VERCEL_ENV:'production', HERMES_GCP_PROVIDER:'projects/302557357656/locations/global/workloadIdentityPools/vercel-workspace/providers/workspace', HERMES_GCP_INVOKER:'workspace-hermes-invoker@onixus-signal.iam.gserviceaccount.com'};
test('private service requires production configuration before requesting credentials',async()=>{
 let calls=0;
 const oidc=async()=>{calls++;return 'private';};
 for(const config of [{}, {...env,VERCEL_ENV:'preview'}, {...env,HERMES_GCP_PROVIDER:'https://attacker.test'}, {...env,HERMES_GCP_INVOKER:'invalid'}]){
  await assert.rejects(cloudRunHeaders(endpoint,{env:config,oidc}),/not configured/);
 }
 await assert.rejects(cloudRunHeaders(new URL('https://attacker.test'),{env,oidc}),/not configured/);
 assert.equal(calls,0);
});
test('exchanges identity only with Google and scopes the resulting token to the private runtime',async()=>{
 const calls:{url:string;options:RequestInit}[]=[];
 const transport:typeof fetch=async(url,options)=>{
  calls.push({url:String(url),options:options!});
  return Response.json(calls.length===1?{access_token:'google-access'}:{token:'google-identity'});
 };
 const headers=await cloudRunHeaders(endpoint,{env,transport,oidc:async()=>'vercel-identity'});
 assert.deepEqual(headers,{'X-Serverless-Authorization':'Bearer google-identity'});
 assert.equal(calls[0].url,'https://sts.googleapis.com/v1/token');
 assert.equal(new Headers(calls[0].options.headers).has('Authorization'),false);
 assert.equal(JSON.parse(String(calls[0].options.body)).subjectToken,'vercel-identity');
 assert.equal(calls[1].url,'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/'+env.HERMES_GCP_INVOKER+':generateIdToken');
 assert.deepEqual(JSON.parse(String(calls[1].options.body)),{audience:endpoint.origin,includeEmail:true});
 assert.equal(new Headers(calls[1].options.headers).get('Authorization'),'Bearer google-access');
 assert.ok(calls.every(c=>c.options.redirect==='error'&&c.options.cache==='no-store'&&c.options.signal));
});
test('failed exchange stops and redacts provider errors and secrets',async()=>{
 let calls=0;
 const transport:typeof fetch=async()=>{calls++;return new Response('secret-token',{status:403});};
 await assert.rejects(cloudRunHeaders(endpoint,{env,transport,oidc:async()=>'private'}),error=>{
  assert.match(String(error),/No planning request was sent/);assert.doesNotMatch(String(error),/secret-token|private/);return true;
 });
 assert.equal(calls,1);
 await assert.rejects(cloudRunHeaders(endpoint,{env,transport:async()=>Response.json({}),oidc:async()=>'private'}),/authentication failed/);
});
test('legacy non-Cloud-Run callers retain application authentication without federation',async()=>{
 assert.deepEqual(await cloudRunHeaders(new URL('https://worker.example'),{env:{}}),{});
});
