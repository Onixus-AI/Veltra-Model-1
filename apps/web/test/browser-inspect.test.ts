import {test} from 'node:test';import assert from 'node:assert/strict';
import {browserUrl,browserNetworkPolicy,checkBrowserDns} from '../lib/browser/policy';
import {inspectBrowserPage} from '../lib/browser/inspect';
test('public browser URLs reject network and credential targets, including encoded IPs',async()=>{
 for(const url of ['http://example.com','file:///etc/passwd','https://localhost','https://127.0.0.1','https://2130706433','https://[::1]','https://user:password@example.com','https://example.com:8443','https://service.internal','https://example.com/?access_token=secret'])assert.throws(()=>browserUrl(url));
 assert.equal(browserUrl('https://example.com/page#heading').href,'https://example.com/page');
 await assert.rejects(()=>checkBrowserDns(new URL('https://example.com'),async()=>[{address:'127.0.0.1',family:4}]),/private/);
 await assert.rejects(()=>checkBrowserDns(new URL('https://example.com'),async()=>[{address:'93.184.216.34',family:4},{address:'169.254.169.254',family:4}]),/private/);
 const p=browserNetworkPolicy('example.com') as any;assert.deepEqual(Object.keys(p.allow),['example.com']);assert.deepEqual(p.allow['example.com'][0].match.method,['GET','HEAD']);assert.equal(p.allow['example.com'][1].response.statusCode,403);assert.ok(p.subnets.deny.includes('169.254.0.0/16'));assert.ok(p.subnets.deny.includes('fc00::/7'));
});
function fixture(fail=''){
 const calls:any[]=[],receipt={url:'https://example.com/page',text:'Rendered page',title:'Example',http_status:200};
 const sandbox={
  runCommand:async(body:any)=>{calls.push(['run',body]);return {exitCode:fail&&body.cmd==='node'?1:0};},
  writeFiles:async(files:any)=>{calls.push(['write',files]);},updateNetworkPolicy:async(policy:any)=>{calls.push(['policy',policy]);},
  readFileToBuffer:async({path}:any)=>Buffer.from(path.endsWith('.jpg')?[255,216,255,217]:JSON.stringify(receipt)),stop:async()=>{calls.push(['stop']);}
 };const create=async(options:any)=>{calls.push(['create',options]);return sandbox;};return {calls,create:create as any,receipt};
}
test('browser setup finishes before restricted page loading; results have verified origin and screenshot, and VM is discarded',async()=>{
 const f=fixture(),r=await inspectBrowserPage({user:crypto.randomUUID(),url:'https://example.com/page',worker:'trusted worker',dns:async()=>{},create:f.create,enabled:true});
 assert.equal(f.calls[0][1].runtime,'node24');assert.equal(f.calls[0][1].image,undefined);assert.equal(f.calls[0][1].persistent,false);assert.equal(f.calls[0][1].timeout,180000);assert.equal(f.calls[0][1].env,undefined);
 const restrict=f.calls.findIndex(c=>c[0]==='policy'),run=f.calls.findIndex(c=>c[0]==='run'&&c[1].cmd==='node');assert.ok(restrict>0&&run>restrict);
 assert.ok(f.calls.some(c=>c[0]==='run'&&c[1].args.includes('playwright@1.64.1')));assert.equal(f.calls.at(-1)[0],'stop');
 assert.match(r.content,/Untrusted browser page data/);assert.equal(r.canvas.kind,'image');assert.match(r.canvas.content,/^data:image\/jpeg;base64,/);
});
test('failed or wrong-origin browser results cannot claim success and always stop the VM',async()=>{
 const f=fixture('run');await assert.rejects(()=>inspectBrowserPage({user:crypto.randomUUID(),url:'https://example.com/page',worker:'trusted',dns:async()=>{},create:f.create,enabled:true}),/could not verify/);assert.equal(f.calls.at(-1)[0],'stop');
 const g=fixture();g.receipt.url='https://attacker.com/';await assert.rejects(()=>inspectBrowserPage({user:crypto.randomUUID(),url:'https://example.com/page',worker:'trusted',dns:async()=>{},create:g.create,enabled:true}),/invalid page receipt/);assert.equal(g.calls.at(-1)[0],'stop');
 await assert.rejects(()=>inspectBrowserPage({user:crypto.randomUUID(),url:'https://example.com',enabled:false}),/not enabled/);
});
