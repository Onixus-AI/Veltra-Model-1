import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compareRepositoryFiles} from '../lib/repository/verify';
const proposed=[{path:'src/flag.mjs',content:'export const enabled=false;'},{path:'flag.test.mjs',content:"import assert from 'node:assert/strict'; import {enabled} from './src/flag.mjs'; assert.equal(enabled,false);"}];
const snapshot={repository:'owner/repo',branch:'main',base_sha:'a'.repeat(40),files:[{path:proposed[0].path,content:'export const enabled=true;'},{path:proposed[1].path,content:null}]};
test('comparison uses separate offline VMs, identical tests, host baseline and actual exit codes',async()=>{
 const vms:{files:any[];stopped:boolean}[]=[];
 const create=async(options:any)=>{
  assert.equal(options.networkPolicy,'deny-all');assert.equal(options.persistent,false);assert.equal(options.timeout,60000);assert.equal(options.env,undefined);assert.equal(options.source,undefined);
  const vm={files:[] as any[],stopped:false};vms.push(vm);
  return {mkDir:async()=>{},writeFiles:async(files:any[])=>{vm.files=files;},runCommand:async(command:any)=>{if(command.cmd==='mkdir'){assert.equal(command.args[0],'-p');assert(command.args.includes('/vercel/sandbox/project'));return {exitCode:0};}assert.deepEqual(command,{cmd:'node',args:['--test','flag.test.mjs'],cwd:'/vercel/sandbox/project'});return {exitCode:vms.length===1?1:0,stdout:async()=>vms.length===1?'assertion failed':'test passed',stderr:async()=>''};},stop:async()=>{vm.stopped=true;}} as any;
 };
 const receipt=await compareRepositoryFiles({snapshot,proposed,test_path:'flag.test.mjs',create});
 assert.equal(vms.length,2);assert(vms.every(vm=>vm.stopped));
 assert.equal(vms[0].files.find(f=>f.path.endsWith('src/flag.mjs')).content.toString(),snapshot.files[0].content);
 assert.equal(vms[1].files.find(f=>f.path.endsWith('src/flag.mjs')).content.toString(),proposed[0].content);
 assert.equal(vms[0].files.find(f=>f.path.endsWith('flag.test.mjs')).content.toString(),vms[1].files.find(f=>f.path.endsWith('flag.test.mjs')).content.toString());
 assert.equal(receipt.before_failed_after_passed,true);assert.equal(receipt.can_publish,false);assert.equal(receipt.base_sha,snapshot.base_sha);assert.equal(receipt.test_sha256.length,64);
});
test('a runtime failure stops the sandbox and produces no passing receipt',async()=>{
 let stopped=false;
 await assert.rejects(compareRepositoryFiles({snapshot,proposed,test_path:'flag.test.mjs',create:async()=>({mkDir:async()=>{},writeFiles:async()=>{},runCommand:async()=>{throw Error('Sandbox expired');},stop:async()=>{stopped=true;}} as any)}),/expired/);
 assert(stopped);
 await assert.rejects(compareRepositoryFiles({snapshot,proposed,test_path:'src/flag.mjs'}),/test.mjs/);
 await assert.rejects(compareRepositoryFiles({snapshot:{...snapshot,files:snapshot.files.slice(1)},proposed,test_path:'flag.test.mjs'}),/every proposed path/);
});
test('nonzero workspace initialization never uploads files or runs a test',async()=>{
 let uploads=0,stops=0,commands=0;
 await assert.rejects(compareRepositoryFiles({snapshot,proposed,test_path:'flag.test.mjs',create:async()=>({writeFiles:async()=>{uploads++;},runCommand:async()=>{commands++;return {exitCode:1};},stop:async()=>{stops++;}} as any)}),/could not initialize/);
 assert.equal(uploads,0);assert.equal(commands,1);assert.equal(stops,1);
});
