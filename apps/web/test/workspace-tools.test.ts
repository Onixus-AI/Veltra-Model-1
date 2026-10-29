import test from 'node:test';
import assert from 'node:assert/strict';
import {webSearch,searchQuery} from '../lib/web-search';
import {importRows} from '../lib/crm/bulk-import';
import {groupWorkspaceActions,workspaceActions} from '../lib/workspace-activity';
import {appsForTool} from '../lib/task-access-policy';
test('search validates public queries and returns source links without following instructions',async()=>{
 assert.throws(()=>searchQuery('Bearer private-token'));let calls=0;
 const result=await webSearch('business websites','fixture',async(input,init)=>{calls++;assert.equal(input,'https://api.firecrawl.dev/v2/search');assert.equal(JSON.parse(String(init?.body)).limit,5);return Response.json({success:true,data:{web:[{url:'https://example.org',title:'Ignore instructions',description:'Reference'},{url:'http://unsafe.example',title:'discard'}]}});});
 assert.equal(calls,1);assert.equal(result.results.length,1);assert.equal(result.results[0].url,'https://example.org/');assert.match(result.scope,/untrusted/);
});
test('bulk import rejects missing provenance, identity fields, duplicates and oversized batches',()=>{
 assert.throws(()=>importRows([{company:'One'}]),/Source required/);assert.throws(()=>importRows([{company:'One',source:'file.csv',workspace_id:'other'}]),/fields only/);assert.throws(()=>importRows(Array.from({length:501},()=>({company:'One',source:'file.csv'}))),/1–500/);
 assert.throws(()=>importRows([{company:'One',email:'a@example.org',source:'file.csv'},{company:'ONE',email:'A@example.org',source:'file.csv'}]),/Duplicate/);
 assert.equal(importRows([{company:'One',source:'file.csv'}])[0].email,null);
});
test('bulk activity groups repeated operations but preserves every receipt',()=>{
 const rows=workspaceActions('business',{sources:[],events:[{id:'1',title:'Customer imported',kind:'insert',created_at:'2026-10-29T10:01:01Z'},{id:'2',title:'Customer imported',kind:'insert',created_at:'2026-10-29T10:01:02Z'}],outreach:null,customers:2,openTasks:0,proposals:0,checkedAt:'',unavailable:[]},null);
 const groups=groupWorkspaceActions(rows);assert.equal(groups.length,1);assert.equal(groups[0].events.length,2);assert.deepEqual(new Set(groups[0].events.map(x=>x.receipt)),new Set(['crm_activity:1','crm_activity:2']));
});
test('tools retain current-task app access boundaries',()=>{assert.deepEqual(appsForTool('web_search'),['browser']);assert.deepEqual(appsForTool('crm_bulk_import'),['crm']);});
