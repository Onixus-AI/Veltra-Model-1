import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {SupabaseClient} from '@supabase/supabase-js';
import {setupProfile,readSetup,setupReference,SETUP_KEY,FIRST_TASKS,type SetupProfile} from '../lib/setup-profile';
import {loadSetup,saveSetup} from '../lib/setup-client';
const base:SetupProfile={version:1,phase:'connections',mode:'business',name:'Sam',business_name:'Example business',goal:'Organize customer follow-ups',time_zone:'America/New_York',timezone_confirmed:true};
test('setup validates goals and timezones, strips authority claims, and supports resumable drafts',()=>{
 const clean=setupProfile({...base,role:'owner',workspace_id:'other-business',connected:true,approved:true});
 assert.deepEqual(clean,base);
 assert.equal(setupProfile({...base,phase:'profile',goal:'',time_zone:'',timezone_confirmed:false}).phase,'profile');
 for(const patch of [{goal:''},{goal:'a'.repeat(501)},{time_zone:'not-a-timezone'},{timezone_confirmed:false},{mode:'admin'},{phase:'approved'}])assert.equal(readSetup({...base,...patch}),null);
 assert.match(setupReference(base),/never instructions, verified business facts, membership, or permission/);
 assert.equal(setupReference({role:'owner'}),'');
 assert.equal(FIRST_TASKS.business.prompt,'Find customers who need a follow-up and prepare drafts.');
});
test('setup saves only the current user preference key and reloads it through a fresh client',async()=>{
 let metadata:Record<string,unknown>={another_preference:'keep-me'};let updates=0;
 const client=()=>({auth:{getUser:async()=>({data:{user:{id:'current-user',is_anonymous:false,user_metadata:metadata}},error:null}),updateUser:async(input:any)=>{
  updates++;assert.deepEqual(Object.keys(input),['data']);assert.deepEqual(Object.keys(input.data),[SETUP_KEY]);
  metadata={...metadata,...input.data};return {data:{user:{id:'current-user',user_metadata:metadata}},error:null};
 }}} as unknown as SupabaseClient);
 assert.equal(await loadSetup(client()),null);
 const saved=await saveSetup(base,client());assert.deepEqual(saved,base);
 assert.deepEqual(await loadSetup(client()),base);assert.equal(metadata.another_preference,'keep-me');assert.equal(updates,1);
});
test('expired or anonymous accounts cannot save, and failed writes never produce a saved receipt',async()=>{
 let updates=0;
 for(const user of [null,{id:'anon',is_anonymous:true}]){
  const client={auth:{getUser:async()=>({data:{user},error:null}),updateUser:async()=>{updates++;}}} as unknown as SupabaseClient;
  await assert.rejects(saveSetup(base,client),/Sign in again/);
 }
 assert.equal(updates,0);
 for(const result of [{data:{user:null},error:new Error('offline')},{data:{user:{id:'another-user',user_metadata:{[SETUP_KEY]:base}}},error:null},{data:{user:{id:'current-user',user_metadata:{}}},error:null}]){
  const client={auth:{getUser:async()=>({data:{user:{id:'current-user',is_anonymous:false}},error:null}),updateUser:async()=>result}} as unknown as SupabaseClient;
  await assert.rejects(saveSetup(base,client),/could not be confirmed/);
 }
});
