import test from 'node:test';
import assert from 'node:assert/strict';
import {workspacePreferences,type PreferenceDependencies} from '../lib/workspace-preferences-api';
import {preferenceKeys,defaultSettings,accountSettings} from '../lib/workspace-settings';
const user={id:'alice',user_metadata:{role:'existing',another_setting:'keep'}};
const request=(body?:unknown,method=body===undefined?'GET':'PUT')=>new Request('https://workspace.example/api/workspace/preferences',{method,headers:{Authorization:'Bearer alice'},...(body===undefined?{}:{body:JSON.stringify(body)})});
function fixture(){let writes:Record<string,unknown>[]=[];const deps:PreferenceDependencies={authenticate:async()=>user,update:async(_request,data)=>{writes.push(data);return {...user,user_metadata:{...user.user_metadata,...data}};}};return {deps,writes};}
test('loads only workspace preferences, without disclosing other metadata',async()=>{
 const {deps,writes}=fixture(),response=await workspacePreferences(request(),deps),body=await response.json();
 assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(body,{userId:'alice',...defaultSettings(),hasLayout:false,hasAppearance:false});assert.equal('role' in body,false);assert.equal(writes.length,0);
});
test('persists only the chosen metadata key and verifies the same user receipt',async()=>{
 const {deps,writes}=fixture(),layout={version:1,name:'Operations',tools:['mail','crm','mail','settings','unknown']};
 const response=await workspacePreferences(request({userId:'alice',section:'layout',value:layout}),deps);
 assert.equal(response.status,200);assert.deepEqual(writes,[{[preferenceKeys.layout]:{version:1,name:'Operations',tools:['mail','crm']}}]);
 assert.deepEqual(await response.json(),{userId:'alice',section:'layout',value:{version:1,name:'Operations',tools:['mail','crm']}});
 const appearance=defaultSettings().appearance;await workspacePreferences(request({userId:'alice',section:'appearance',value:appearance}),deps);
 assert.deepEqual(writes[1],{[preferenceKeys.appearance]:appearance});assert.equal(Object.keys(writes[1]).includes(preferenceKeys.layout),false);
});
test('rejects anonymous, expired and switched accounts before any write',async()=>{
 for(const authenticate of [async()=>({...user,is_anonymous:true}),async()=>{throw Error('401:Sign in again.');},async()=>({...user,id:'bob'})]){
  const {deps,writes}=fixture();deps.authenticate=authenticate;
  const response=await workspacePreferences(request({userId:'alice',section:'layout',value:defaultSettings().layout}),deps);assert.ok([401,409].includes(response.status));assert.equal(writes.length,0);
 }
});
test('rejects privilege fields, unsupported versions, malformed JSON and oversized requests',async()=>{
 const invalid=[{userId:'alice',section:'role',value:{version:1}},{userId:'alice',section:'layout',value:{version:2}},{userId:'alice',section:'layout',value:{version:1}},{userId:'alice',section:'layout',value:defaultSettings().layout,role:'admin'},{userId:'alice',section:'appearance',value:{version:1,ignored:'x'.repeat(9000)}}];
 for(const body of invalid){const {deps,writes}=fixture(),response=await workspacePreferences(request(body),deps);assert.ok([400,413].includes(response.status));assert.equal(writes.length,0);}
 const {deps}=fixture();assert.equal((await workspacePreferences(new Request('https://workspace.example/api/workspace/preferences',{method:'PUT',body:'invalid'}),deps)).status,400);
 assert.equal((await workspacePreferences(request(undefined,'DELETE'),deps)).status,405);
});
test('never reports success for failed, missing, mismatched or altered persistence receipts',async()=>{
 for(const update of [async()=>{throw Error('503:offline');},async()=>({...user,id:'bob'}),async()=>user,async()=>({...user,user_metadata:{[preferenceKeys.layout]:{version:1,name:'changed',tools:[]}}})]){
  const {deps}=fixture();deps.update=update;const response=await workspacePreferences(request({userId:'alice',section:'layout',value:defaultSettings().layout}),deps);assert.ok([502,503].includes(response.status));
 }
});
test('independent metadata keys load together and invalid preferences use safe defaults',()=>{
 const prefs=accountSettings({id:'alice',user_metadata:{[preferenceKeys.layout]:{version:1,name:'Saved layout',tools:['crm']},[preferenceKeys.appearance]:{version:1,theme:'light',density:'compact',accent:'purple'}}});
 assert.equal(prefs.layout.name,'Saved layout');assert.equal(prefs.appearance.theme,'light');assert.equal(prefs.hasLayout,true);
 assert.deepEqual(accountSettings({id:'bob',user_metadata:{}}).layout,defaultSettings().layout);
});
