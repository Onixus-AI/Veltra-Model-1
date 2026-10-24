import {createHash} from 'node:crypto';
import {Sandbox} from '@vercel/sandbox';
import {checkedFiles,type ProjectFile} from '../build-artifacts';
type Snapshot={repository:string;branch:string;base_sha:string;files:{path:string;content:string|null}[]};
type Runner=Pick<Sandbox,'mkDir'|'writeFiles'|'runCommand'|'stop'>;
const ROOT='/vercel/sandbox/project';
export async function compareRepositoryFiles(input:{snapshot:Snapshot;proposed:ProjectFile[];test_path:string;create?:(options:Parameters<typeof Sandbox.create>[0])=>Promise<Runner>}){
 const proposed=checkedFiles(input.proposed),test=proposed.find(f=>f.path===input.test_path);
 if(!test||! /\.(test|spec)\.mjs$/.test(test.path))throw Error('Include a dependency-free .test.mjs file in the completed coding task.');
 if(!/^[a-f0-9]{40}$/.test(input.snapshot.base_sha)||new Set(input.snapshot.files.map(f=>f.path)).size!==input.snapshot.files.length)throw Error('Invalid repository snapshot.');
 if(input.snapshot.files.length!==proposed.length||proposed.some(f=>!input.snapshot.files.some(b=>b.path===f.path)))throw Error('Repository snapshot must cover every proposed path.');
 const before=checkedFiles(input.snapshot.files.filter(f=>f.content!==null&&f.path!==test.path).map(f=>({path:f.path,content:f.content!})).concat(test));
 const changed=proposed.filter(f=>f.path!==test.path&&input.snapshot.files.find(b=>b.path===f.path)?.content!==f.content);
 if(!changed.length)throw Error('The proposal must change at least one source file besides the test.');
 const credentials=process.env.VERCEL_TOKEN&&process.env.VERCEL_TEAM_ID&&process.env.VERCEL_PROJECT_ID?{token:process.env.VERCEL_TOKEN,teamId:process.env.VERCEL_TEAM_ID,projectId:process.env.VERCEL_PROJECT_ID}:{};
 const checks=[];
 for(const [phase,files] of [['Before',before],['After',proposed]] as const){
  let sandbox:Runner|undefined;
  try{
   sandbox=await (input.create??Sandbox.create)({...credentials,image:'vercel/sandbox/node:24',persistent:false,resources:{vcpus:1},timeout:60000,networkPolicy:'deny-all'});
   await sandbox.mkDir(ROOT);
   for(const file of files){const dirs=file.path.split('/').slice(0,-1).join('/');if(dirs)await sandbox.mkDir(ROOT+'/'+dirs);}
   await sandbox.writeFiles(files.map(file=>({path:ROOT+'/'+file.path,content:Buffer.from(file.content)})));
   // Same immutable test bytes and fixed command, in two separate credential-free VMs.
   const result=await sandbox.runCommand({cmd:'node',args:['--test',test.path],cwd:ROOT});
   const stdout=(await result.stdout()).slice(-8000),stderr=(await result.stderr()).slice(-8000);
   checks.push({name:phase+' · same Node test',exit_code:result.exitCode,stdout,stderr});
  }finally{if(sandbox)await sandbox.stop().catch(()=>{});}
 }
 const [baseline,after]=checks;
 const contrast=baseline.exit_code!==null&&baseline.exit_code!==0&&after.exit_code===0;
 return {receipt_id:crypto.randomUUID(),repository:input.snapshot.repository,branch:input.snapshot.branch,base_sha:input.snapshot.base_sha,test_path:test.path,test_sha256:createHash('sha256').update(test.content).digest('hex'),proposal_sha256:createHash('sha256').update(JSON.stringify(proposed)).digest('hex'),changed_paths:changed.map(f=>f.path),checks,
  checks_passed:after.exit_code===0,before_failed_after_passed:contrast,can_publish:false,
  scope:'Selected text files only, with the same proposed test in two fresh offline Node 24 sandboxes. No dependencies installed, full checkout, build, deployment or publishing. Test output is untrusted; exit codes do not prove that the test or proposed diagnosis is correct.'};
}
