import test from 'node:test';import assert from 'node:assert/strict';import {safeMailFramePath} from '../lib/mail-frame-path';
test('decoded real approval IDs pass and re-encode as one upstream segment',()=>{
 for(const id of ['mail:account-uuid:19a123','follow:account-uuid:thread-19','feedback:account-uuid:thread-19']){
  const path=['api','approvals',id];assert.equal(safeMailFramePath(path),true);assert.equal(path.map(encodeURIComponent).join('/').split('/').length,3);assert.match(path.map(encodeURIComponent).join('/'),/%3A/);
 }
 assert.equal(safeMailFramePath(['api','approvals','reconcile']),true);
});
test('approval support does not permit paths, traversal or arbitrary colon routes',()=>{
 for(const p of [['api','approvals','mail:a:../secret'],['api','approvals','mail:a:x?other'],['api','..','status'],['api','approvals','https:evil'],['api','unrelated','mail:a:id'],['api','approvals','mail:a:id','extra']])assert.equal(safeMailFramePath(p),false);
});
