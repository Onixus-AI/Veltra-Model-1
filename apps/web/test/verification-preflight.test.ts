import test from 'node:test';import assert from 'node:assert/strict';
import {verificationPreflight,isPreflightCall,ONYX_VERIFICATION_POLICY} from '../lib/verification-preflight';
const tools=['onyx_capabilities','mail_health','google_status','calendar_status'].map(name=>({type:'function',function:{name}}));
const check=(text:string,tail:unknown[]=[],choice?:unknown)=>verificationPreflight([{role:'user',content:text},...tail],tools,choice);
test('live account prompts request a supported read before the answer',()=>{
 assert.equal(check('Can Signal generate these images?'),'onyx_capabilities');
 assert.equal(check('Is my Gmail processing mail?'),'mail_health');
 assert.equal(check('Is my Google Calendar connected?'),'calendar_status');
 assert.equal(check('Read the saved brand and approved logo'),'onyx_capabilities');
 assert.equal(check('Find my Google Drive files'),'google_status');
});
test('preflight respects explicit tool choices, current-turn receipts and tool opt-out',()=>{
 assert.equal(check('Check Gmail',[],'none'),null);
 assert.equal(check('Check Gmail',[],{type:'function',function:{name:'mail_search'}}),null);
 assert.equal(check('Check Gmail',[{role:'tool',content:'Verified current status'}]),null);
 assert.equal(check('Discuss Gmail without using any tools'),null);
 assert.equal(check("Don't use tools; explain Gmail conceptually"),null);
 assert.equal(check('Write a poem'),null);
 assert.equal(verificationPreflight([{role:'user',content:'Check Gmail'}],[],undefined),null);
});
test('old receipts do not authorize claims about the current request and scope is explicit',()=>{
 assert.equal(verificationPreflight([{role:'tool',content:'old'},{role:'user',content:'Check Gmail now'}],tools,'auto'),'mail_health');
 assert.match(ONYX_VERIFICATION_POLICY,/does not prove the linked Signal business lacks/);
 assert.match(ONYX_VERIFICATION_POLICY,/failed or denied read means unverified, not empty/);
});

test('a required preflight accepts only reads, including the action on multiplexed tools',()=>{
 const call=(name:string,args:unknown)=>({function:{name,arguments:JSON.stringify(args)}});
 assert.equal(isPreflightCall(call('signal_creative',{action:'context'}),'signal_creative'),true);
 assert.equal(isPreflightCall(call('signal_creative',{action:'propose',brief:{}}),'signal_creative'),false);
 assert.equal(isPreflightCall(call('mail_health',{action:'reconcile'}),'mail_health'),false);
 assert.equal(isPreflightCall(call('mail_health',{action:'status'}),'mail_health'),true);
});
