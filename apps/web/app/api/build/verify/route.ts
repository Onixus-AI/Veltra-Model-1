import {NextRequest} from 'next/server';
import {Sandbox} from '@vercel/sandbox';
import {gatewayAuthorization,gatewayUrl} from '@/lib/gateway';
import {crmUser} from '@/lib/crm/server';
import {checkedFiles} from '@/lib/build-artifacts';
export const runtime='nodejs';
export const maxDuration=300;
type Action={type:'click'|'fill';selector:string;text?:string};
const harness=`const {chromium:pw}=require('playwright-core');
const chromiumModule=require('@sparticuz/chromium');
const chromium=chromiumModule.default??chromiumModule;
const fs=require('node:fs');
(async()=>{const browser=await pw.launch({args:chromium.args,executablePath:await chromium.executablePath(),headless:true});
try{const page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',route=>route.request().url().startsWith('file:///vercel/sandbox/project/')||route.request().url().startsWith('data:')?route.continue():route.abort());
await page.goto('file:///vercel/sandbox/project/index.html',{waitUntil:'load',timeout:15000});
for(const action of JSON.parse(fs.readFileSync('/vercel/sandbox/.veltra-tools/actions.json','utf8'))){
if(action.type==='click')await page.locator(action.selector).click({timeout:3000});
else await page.locator(action.selector).fill(action.text||'',{timeout:3000});}
await page.screenshot({path:'/vercel/sandbox/.veltra-tools/screen.png'});
fs.writeFileSync('/vercel/sandbox/.veltra-tools/browser.json',JSON.stringify({title:await page.title(),errors}));
}finally{await browser.close();}})().catch(e=>{console.error(e.message);process.exit(1)});`;

export async function POST(request:NextRequest){
 const authorization=gatewayAuthorization(request);
 if(!authorization)return Response.json({detail:'Sign in to Veltra.'},{status:401});
 let sandbox:Awaited<ReturnType<typeof Sandbox.create>>|undefined;
 let finishVerification:((success:boolean)=>Promise<void>)|undefined;
 try{
  const raw=await request.text();if(raw.length>16000)return Response.json({detail:'Request is too large.'},{status:413});
  const body=JSON.parse(raw);
  if(typeof body.run_id!=='string'||!/^[a-f0-9-]{36}$/i.test(body.run_id))throw new Error('Choose a completed coding task.');
  const actions:Action[]=body.actions??[];
  if(!Array.isArray(actions)||actions.length>10||actions.some(a=>!a||!['click','fill'].includes(a.type)||typeof a.selector!=='string'||a.selector.length>200||a.text!==undefined&&(typeof a.text!=='string'||a.text.length>1000)))throw new Error('Provide at most ten browser actions.');
  const upstream=await fetch(`${gatewayUrl()}/v1/agent-runs/${body.run_id}`,{headers:{Authorization:authorization},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!upstream.ok)return Response.json({detail:'Task could not be accessed.'},{status:upstream.status});
  const run=await upstream.json();
  if(run.status!=='completed')throw new Error('Wait for the team to complete this task.');
  const files=checkedFiles(run.state?.artifacts?.files);
  const browser=files.some(f=>f.path==='index.html');
  if(actions.length&&!browser)throw new Error('Browser actions require a self-contained index.html.');
  const {client}=await crmUser(request);
  const claim=await client.rpc('claim_agent_verification',{p_id:run.id});
  if(claim.error||claim.data!==true)return Response.json({detail:'Verification is already running, completed, or has reached its two-attempt limit.'},{status:409});
  finishVerification=async(success)=>{await client.rpc('finish_agent_verification',{p_id:run.id,p_success:success});};
  const credentials=process.env.VERCEL_TOKEN&&process.env.VERCEL_TEAM_ID&&process.env.VERCEL_PROJECT_ID?{token:process.env.VERCEL_TOKEN,teamId:process.env.VERCEL_TEAM_ID,projectId:process.env.VERCEL_PROJECT_ID}:{};
  sandbox=await Sandbox.create({...credentials,resources:{vcpus:1},timeout:180000,persistent:false,
   networkPolicy:browser?{allow:['registry.npmjs.org']}:'deny-all'});
  await sandbox.mkDir('/vercel/sandbox');
  await sandbox.mkDir('/vercel/sandbox/project');
  // Generated code is written only inside the isolated VM, without host credentials.
  for(const file of files){const dirs=file.path.split('/').slice(0,-1).join('/');if(dirs)await sandbox.mkDir('/vercel/sandbox/project/'+dirs);}
  await sandbox.writeFiles(files.map(f=>({path:'/vercel/sandbox/project/'+f.path,content:Buffer.from(f.content)})));
  if(typeof run.state.image==='string'&&/^data:image\/(png|jpeg|webp);base64,/.test(run.state.image)){
   await sandbox.mkDir('/vercel/sandbox/project/assets');
   await sandbox.writeFiles([{path:'/vercel/sandbox/project/assets/generated.png',content:Buffer.from(run.state.image.split(',')[1],'base64')}]);
  }
  if(browser){
   await sandbox.mkDir('/vercel/sandbox/.veltra-tools');
   await sandbox.writeFiles([{path:'/vercel/sandbox/.veltra-tools/package.json',content:Buffer.from(JSON.stringify({private:true,dependencies:{'playwright-core':'1.64.1','@sparticuz/chromium':'153.0.0'}}))},
    {path:'/vercel/sandbox/.veltra-tools/browser.cjs',content:Buffer.from(harness)},
    {path:'/vercel/sandbox/.veltra-tools/actions.json',content:Buffer.from(JSON.stringify(actions))}]);
   const install=await sandbox.runCommand({cmd:'npm',args:['install','--ignore-scripts','--no-audit','--no-fund'],cwd:'/vercel/sandbox/.veltra-tools'});
   if(install.exitCode!==0)throw new Error('The isolated browser could not start.');
  }
  await sandbox.updateNetworkPolicy('deny-all');
  const checks:{name:string;exit_code:number|null;stdout:string;stderr:string}[]=[];
  async function check(name:string,cmd:string,args:string[]){
   const result=await sandbox!.runCommand({cmd,args,cwd:'/vercel/sandbox/project'});
   checks.push({name,exit_code:result.exitCode,stdout:(await result.stdout()).slice(-8000),stderr:(await result.stderr()).slice(-8000)});
  }
  let screenshot:string|undefined,browserResult:unknown;
  if(browser){
   await check('Browser: render and requested actions','node',['/vercel/sandbox/.veltra-tools/browser.cjs']);
   const screen=await sandbox.readFileToBuffer({path:'/vercel/sandbox/.veltra-tools/screen.png'});
   if(screen)screenshot='data:image/png;base64,'+screen.toString('base64');
   const result=await sandbox.readFileToBuffer({path:'/vercel/sandbox/.veltra-tools/browser.json'});
   if(result)browserResult=JSON.parse(result.toString());
  }
  for(const file of files){
   if(/\.(js|mjs|cjs)$/.test(file.path))await check('Syntax: '+file.path,'node',['--check',file.path]);
   if(/\.py$/.test(file.path))await check('Syntax: '+file.path,'python3',['-m','py_compile',file.path]);
  }
  const jsTests=files.filter(f=>/\.(test|spec)\.(js|mjs|cjs)$/.test(f.path));
  if(jsTests.length)await check('Node tests','node',['--test',...jsTests.map(f=>f.path)]);
  if(files.some(f=>/(^|\/)test_[^/]+\.py$/.test(f.path)))await check('Python tests','python3',['-m','unittest','discover','-s','.', '-p','test_*.py']);
  await finishVerification(true);finishVerification=undefined;
  return Response.json({run_id:run.id,receipt_id:crypto.randomUUID(),sandbox_name:sandbox.name,checks,screenshot,browser:browserResult,
   scope:'Isolated generated files only; external sites, package installation for generated projects, and deployment are not performed.',
   checks_passed:checks.length>0&&checks.every(c=>c.exit_code===0)&&!(browserResult as {errors?:string[]}|undefined)?.errors?.length}, {headers:{'Cache-Control':'no-store'}});
 }catch(error){
  if(finishVerification)await finishVerification(false).catch(()=>{});
  console.error('Build verification failed',error instanceof Error?error.name:'Error');
  return Response.json({detail:'Verification could not finish. Check task files and Vercel Sandbox access; no successful test is claimed.'},{status:503});
 }finally{if(sandbox)await sandbox.stop().catch(()=>{});}
}
