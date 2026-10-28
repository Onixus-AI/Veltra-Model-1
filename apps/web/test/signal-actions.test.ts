import {test} from 'node:test';
import assert from 'node:assert/strict';
import {signalAction,signalBusinessClient} from '../lib/signal-actions';
const id='11111111-1111-4111-8111-111111111111',client='22222222-2222-4222-8222-222222222222',base={type:'onixus.signal.action',id,client};
test('Signal actions reject missing tenant identity, arbitrary routes and oversized payloads',()=>{
 assert.equal(signalAction({...base,client:undefined,action:'signature',signature:'Name'}),null);
 assert.equal(signalAction({...base,action:'open',target:'https://attacker.test'}),null);
 assert.equal(signalAction({...base,id:'-'.repeat(36),action:'open',target:'mail'}),null);
 assert.equal(signalAction({...base,action:'signature',signature:'x'.repeat(201)}),null);
 assert.equal(signalAction({...base,action:'google',kind:'doc',title:'Brand',content:'x'.repeat(200001)}),null);
 assert.deepEqual(signalAction({...base,action:'signature',signature:' Name ',extra:'discard'}),{...base,action:'signature',signature:'Name'});
 assert.equal(signalAction({...base,action:'google',kind:'sheet',title:'Brand',content:'Field,Value'})?.action,'google');
});
test('original Onixus account resolves only for its exact Workspace; other clients stay isolated',()=>{
 const admin='cf7fd56a-ef84-48f4-8049-36282dec583b',workspace='8350462c-2cca-4541-b299-acbc4c5f1162';
 assert.equal(signalBusinessClient(workspace,admin),'679cae69-806e-4691-9ef3-241a7ab86501');
 assert.equal(signalBusinessClient(id,admin),admin);assert.equal(signalBusinessClient(workspace,client),client);
});
test('calendar reminders require a real post ID and parseable date',()=>{
 const action={...base,action:'calendar',queue_id:id,title:'Signal post',description:'Created content',scheduled_for:'2026-11-01T15:00:00Z'};
 assert.equal(signalAction(action)?.action,'calendar');assert.equal(signalAction({...action,scheduled_for:'tomorrow'}),null);assert.equal(signalAction({...action,queue_id:'not-a-post'}),null);
});
