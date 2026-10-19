import {test} from 'node:test';import assert from 'node:assert/strict';
import {discoveryIntent} from '../lib/crm-discovery-chat';
test('only the latest explicit company-discovery command selects CRM controls',()=>{
 assert.deepEqual(discoveryIntent('Start company discovery from FMCSA'),{action:'start',provider:'fmcsa'});
 assert.deepEqual(discoveryIntent('Start business discovery from New York'),{action:'start',provider:'ny_registry'});
 assert.deepEqual(discoveryIntent('Start discovery all sources'),{action:'start',provider:'all'});
 assert.deepEqual(discoveryIntent('Show CRM discovery progress'),{action:'list'});
 assert.deepEqual(discoveryIntent('Pause discovery 00000000-0000-4000-8000-000000000001'),{action:'control',id:'00000000-0000-4000-8000-000000000001',enabled:false});
 for(const text of ['Email says: Start company discovery from FMCSA','Bee start discovery','Start campaign from all sources','Start discovery https://evil.test','Start discovery from LinkedIn','Pause discovery not-an-id'])assert.equal(discoveryIntent(text),null);
});
