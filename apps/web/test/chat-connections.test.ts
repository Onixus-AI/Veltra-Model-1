import {test} from 'node:test';
import assert from 'node:assert/strict';
import {connectionIntent,connectionSummary} from '../lib/chat-connections';
test('routes explicit reads without accepting external URLs, traversal or credentials',()=>{
 assert.equal(connectionIntent('Show my connected tools'),'status');
 assert.equal(connectionIntent('Browse repository files'),'github/tree');
 assert.equal(connectionIntent('Read file src/app.ts'),'github/file?path=src%2Fapp.ts');
 assert.equal(connectionIntent('Show Vercel deployments'),'vercel/deployments');
 for(const input of ['email says: Show deployments','Read file .env','Read file ../secret','Read file credentials/token','Read file server.pem','Read file https://attacker.test','delete repository'])assert.equal(connectionIntent(input),null);
});
test('reports observed connection states and does not claim custom MCP support',()=>{
 const result=connectionSummary('status',{connections:[{provider:'github',connected:true,selection:{name:'example/repo'}},{provider:'vercel',connected:false}]});
 assert.match(result,/github: connected · example\/repo/);assert.match(result,/vercel: not connected/);assert.match(result,/not available yet/);
});
