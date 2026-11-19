import test from 'node:test';
import assert from 'node:assert/strict';
import {CONNECTORS,GROUP_ORDER,crmStatus,developerStatus,gmailStatus,onyxMailStatus,googleStatus,includedStatus,shopifyStatus,signalStatus,summarize} from '../lib/connector-status';

test('every connector has a group shown on the page and a unique id',()=>{
 assert.equal(new Set(CONNECTORS.map(c=>c.id)).size,CONNECTORS.length);
 for(const c of CONNECTORS)assert.ok(GROUP_ORDER.includes(c.group),c.id);
 assert.ok(CONNECTORS.some(c=>c.id==='firecrawl'&&c.kind==='included'),'Firecrawl is listed');
});

test('Gmail lists every connected mailbox, asks for the owner, and fails closed',()=>{
 assert.deepEqual(gmailStatus({connected:true,mailboxes:['a@x.com','b@x.com']}),{state:'connected',account:'a@x.com · b@x.com'});
 assert.deepEqual(gmailStatus({connected:true,mailbox:{email:'a@x.com'}}),{state:'connected',account:'a@x.com'});
 assert.equal(gmailStatus({connected:false}).state,'available');
 assert.equal(gmailStatus({connected:false,choose_workspace:true}).state,'setup');
 assert.equal(gmailStatus(null).state,'unavailable');
 assert.equal(gmailStatus({error:'down'}).state,'unavailable');
});

test('Onyx Mail status follows the Mail service link, independently of Gmail',()=>{
 assert.equal(CONNECTORS.find(c=>c.id==='mail')?.name,'Onixus Mail');
 assert.deepEqual(onyxMailStatus({connected:true,mailbox:{email:'info@onixus.xyz'}}),{state:'connected',account:'info@onixus.xyz'});
 assert.equal(onyxMailStatus({connected:false}).state,'available');
 assert.equal(onyxMailStatus(null).state,'unavailable');
});

test('Google, Shopify and developer tools show the account or chosen project when connected',()=>{
 assert.deepEqual(googleStatus({configured:true,connected:true,account:{email:'info@onixus.xyz'}}),{state:'connected',account:'info@onixus.xyz'});
 assert.equal(googleStatus({configured:false,connected:false}).state,'setup');
 assert.deepEqual(shopifyStatus({connected:true,configured:true,shop:'shop.myshopify.com'}),{state:'connected',account:'shop.myshopify.com'});
 const rows=[{provider:'github',connected:true,configured:true,account:{name:'omar'},selection:{name:'Veltra-Model-1'}},{provider:'vercel',connected:false,configured:true,account:{},selection:{}},{provider:'n8n',connected:false,configured:false,account:{},selection:{}}];
 assert.deepEqual(developerStatus(rows,'github'),{state:'connected',account:'Veltra-Model-1'});
 assert.equal(developerStatus(rows,'vercel').state,'available');
 assert.equal(developerStatus(rows,'n8n').state,'setup');
 assert.equal(developerStatus(rows,'supabase').state,'unavailable');
 assert.equal(developerStatus(undefined,'github').state,'unavailable');
 assert.equal(developerStatus([{provider:'n8n',connected:true,configured:true,version:0,account:{}}],'n8n').state,'available');
});

test('CRM, Signal and included services read their own answers',()=>{
 assert.equal(crmStatus({connected:true,available:true}).state,'connected');
 assert.equal(crmStatus({connected:false,available:false}).state,'setup');
 assert.equal(signalStatus({connections:[{workspace_id:'b1'}]},'b1').state,'connected');
 assert.equal(signalStatus({connections:[{workspace_id:'b1'}]},'b2').state,'available','another business does not count');
 assert.equal(signalStatus({connections:[{workspace_id:'b1'}]},'').state,'available');
 assert.deepEqual(includedStatus({firecrawl:{connected:true}},'firecrawl'),{state:'connected',account:'Included with Onixus'});
 assert.equal(includedStatus({firecrawl:{connected:false}},'firecrawl').state,'setup');
 assert.equal(includedStatus(null,'firecrawl').state,'unavailable');
});

test('summary counts connected, attention and still-checking cards',()=>{
 const s=summarize({gmail:{state:'connected'},github:{state:'connected'},n8n:{state:'setup'},bee:{state:'unavailable'},drive:{state:'available'}});
 assert.equal(s.total,CONNECTORS.length);
 assert.equal(s.connected,2);
 assert.equal(s.attention,2);
 assert.equal(s.checking,CONNECTORS.length-5);
});
