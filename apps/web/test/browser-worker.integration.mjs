import {test} from 'node:test';import assert from 'node:assert/strict';
import https from 'node:https';import {mkdtemp,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {inspectPage} from '../lib/browser/inspect-page.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
test('real Chromium renders a page, blocks writes and other origins, reports fields without values, and forgets cookies',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'veltra-browser-test-'));let writes=0,other=0;const cookies=[];
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',dir+'/key.pem','-out',dir+'/cert.pem','-days','1','-subj','/CN=localhost'],{stdio:'ignore'});
 const tls={key:await readFile(dir+'/key.pem'),cert:await readFile(dir+'/cert.pem')};
 const external=https.createServer(tls,(_req,res)=>{other++;res.end('Blocked origin');});await new Promise(r=>external.listen(0,'127.0.0.1',r));
 const otherPort=external.address().port;
 const server=https.createServer(tls,(req,res)=>{
  if(req.method==='POST'){writes++;res.end('Should never execute');return;}
  if(req.url==='/redirect'){res.writeHead(302,{Location:`https://127.0.0.1:${otherPort}/`});res.end();return;}
  if(req.url==='/')cookies.push(req.headers.cookie??'');
  res.setHeader('Content-Type','text/html');res.end(`<title>Browser fixture</title><body><h1>Public page</h1><a href="/next">Next page</a><label>Password<input type="password" value="never-display-this-secret"></label><button>Submit</button><script>document.body.append(' Rendered by JavaScript');document.cookie='probe=1';fetch('/write',{method:'POST'}).catch(()=>{});fetch('https://127.0.0.1:${otherPort}/').catch(()=>{});</script></body>`);
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`https://127.0.0.1:${server.address().port}/`;
 // The fixture overrides TLS trust only in this test; the production worker never ignores TLS errors.
 const driver={launch:async options=>{const b=await chromium.launch(options),create=b.newContext.bind(b);b.newContext=options=>create({...options,ignoreHTTPSErrors:true});return b;}};
 try{
  for(let i=0;i<2;i++){const r=await inspectPage({url},driver);assert.match(r.snapshot.text,/Rendered by JavaScript/);assert.ok(!JSON.stringify(r.snapshot).includes('never-display-this-secret'));assert.equal(r.snapshot.fields[0].type,'password');assert.ok(r.snapshot.blocked_requests>=2);assert.equal(r.screenshot[0],255);assert.equal(r.screenshot[1],216);}
  assert.deepEqual(cookies,['','']);assert.equal(writes,0);assert.equal(other,0);
  await assert.rejects(()=>inspectPage({url:url+'redirect'},driver));assert.equal(other,0);
 }finally{await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>external.close(r))]);await rm(dir,{recursive:true,force:true});}
});
