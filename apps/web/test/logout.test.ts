import {test} from 'node:test';
import assert from 'node:assert/strict';
import {browserSupabase} from '../lib/supabase';
import {signOutCurrentBrowser} from '../lib/client-session';

test('logout clears the fallback key and revokes only the current session; failures are not success', async t=>{
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://logout-fixture.supabase.co';
 process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='fixture-public-key';
 const values=new Map([['veltra-api-key','fixture-secret'],['veltra-password-recovery','1'],['veltra-appearance-v1','keep']]);
 Object.defineProperty(globalThis,'window',{configurable:true,value:{sessionStorage:{getItem:(k:string)=>values.get(k)??null,removeItem:(k:string)=>values.delete(k)}}});
 t.after(()=>{Reflect.deleteProperty(globalThis,'window');delete process.env.NEXT_PUBLIC_SUPABASE_URL;delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;});
 const auth=browserSupabase()!.auth;
 const logout=t.mock.method(auth,'signOut',async(options:unknown)=>{assert.deepEqual(options,{scope:'local'});return {error:null};});
 await signOutCurrentBrowser();
 assert.equal(values.has('veltra-api-key'),false);
 assert.equal(values.has('veltra-password-recovery'),false);
 assert.equal(values.get('veltra-appearance-v1'),'keep');
 assert.equal(logout.mock.callCount(),1);
 values.set('veltra-api-key','fixture-secret');
 logout.mock.mockImplementation(async()=>{throw Error('Provider offline');});
 await assert.rejects(signOutCurrentBrowser(),/Provider offline/);
 assert.equal(values.has('veltra-api-key'),false);
});
