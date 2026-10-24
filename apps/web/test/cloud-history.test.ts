import {test} from 'node:test';
import assert from 'node:assert/strict';
import {saveCloudHistory} from '../lib/cloud-history';
const write={id:'conversation',revision:3,messages:[{role:'assistant' as const,content:'Keep this reply'}]};
test('retries a network failure without generating another answer',async()=>{
 const calls:string[]=[];let writes=0;
 const request=async<T>(path:string,method='GET',body?:unknown):Promise<T>=>{calls.push(method);if(method==='GET')return {revision:3,messages:[]} as T;assert.deepEqual(body,{revision:3,messages:write.messages});if(writes++===0)throw TypeError('Failed to fetch');return {revision:4} as T;};
 assert.deepEqual(await saveCloudHistory(request,write),{revision:4});assert.deepEqual(calls,['PUT','GET','PUT']);
});
test('a committed write with a lost response is verified without a duplicate write',async()=>{
 let puts=0;const request=async<T>(_path:string,method='GET'):Promise<T>=>{if(method==='PUT'){puts++;throw TypeError('Failed to fetch');}return {revision:4,messages:[{content:'Keep this reply',role:'assistant'}]} as T;};
 assert.deepEqual(await saveCloudHistory(request,write),{revision:4});assert.equal(puts,1);
});
test('never overwrites a different reply from another tab',async()=>{
 let puts=0;const request=async<T>(_path:string,method='GET'):Promise<T>=>{if(method==='PUT'){puts++;throw Object.assign(Error('Conflict'),{status:409});}return {revision:4,messages:[{role:'assistant',content:'Another writer'}]} as T;};
 await assert.rejects(saveCloudHistory(request,write),/another tab/);assert.equal(puts,1);
});
test('authentication failures are not retried as writes',async()=>{
 let puts=0;const request=async<T>(_path:string,method='GET'):Promise<T>=>{if(method==='PUT')puts++;throw Object.assign(Error('Sign in again'),{status:401});};
 await assert.rejects(saveCloudHistory(request,write),/Sign in again/);assert.equal(puts,1);
});
