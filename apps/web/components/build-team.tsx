'use client';
import Link from 'next/link';
import {useCallback,useEffect,useRef,useState} from 'react';
import {gatewayAuthorizationHeaders} from '@/lib/client-session';
import {connectionRequest} from '@/lib/connections-client';
import type {ProjectFile} from '@/lib/build-artifacts';

type Receipt={role:string;model:string;credits:number;provider_request_id?:string};
type Run={id:string;status:string;stage:string;credits_reserved:number;credits_used:number;error?:string;created_at:string;cancel_requested:boolean;verification_attempts?:number;verification_status?:string;
 state?:{plan?:string;observations?:string;artifacts?:{summary:string;files:ProjectFile[];browser_actions?:unknown[]};review?:{approved:boolean;summary:string;issues:string[]};receipts?:Receipt[];image?:string}};
type Verification={receipt_id:string;checks_passed:boolean;screenshot?:string;browser?:{title:string;errors:string[]};checks:{name:string;exit_code:number;stdout:string;stderr:string}[]};
async function api<T>(path:string,method='GET',body?:unknown):Promise<T>{
 const response=await fetch(path,{method,headers:{'Content-Type':'application/json',...await gatewayAuthorizationHeaders()},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store'});
 const data=await response.json();if(!response.ok)throw new Error(typeof data.detail==='string'?data.detail:'The task service could not complete this request.');return data as T;
}
function download(name:string,content:string,type='text/plain'){
 const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export default function BuildTeam(){
 const [task,setTask]=useState(''),[context,setContext]=useState(''),[screenshot,setScreenshot]=useState<string|null>(null),[image,setImage]=useState(false),[budget,setBudget]=useState(12000);
 const [run,setRun]=useState<Run|null>(null),[history,setHistory]=useState<Run[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[checking,setChecking]=useState(false),[verification,setVerification]=useState<Verification|null>(null),[selectedFile,setSelectedFile]=useState('');
 const [repositoryFiles,setRepositoryFiles]=useState<{path:string}[]>([]),[repositoryPath,setRepositoryPath]=useState(''),[repository,setRepository]=useState('');
 const operation=useRef<{signature:string;id:string}|null>(null),pollVersion=useRef(0);
 const active=run&&['queued','running'].includes(run.status);
 const refreshHistory=useCallback(()=>api<{runs:Run[]}>('/api/agent-runs').then(r=>setHistory(r.runs)),[]);
 useEffect(()=>{let live=true;void api<{runs:Run[]}>('/api/agent-runs').then(r=>{if(live)setHistory(r.runs);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[]);
 useEffect(()=>{
  if(!run||!['queued','running'].includes(run.status))return;
  let live=true;const version=++pollVersion.current;
  const timer=setInterval(()=>{void api<Run>('/api/agent-runs/'+run.id).then(r=>{if(live&&version===pollVersion.current){setRun(r);if(!['queued','running'].includes(r.status))void refreshHistory();}}).catch(e=>{if(live)setError(e.message);});},2500);
  return()=>{live=false;clearInterval(timer);};
 },[run?.id,run?.status,refreshHistory]);
 async function submit(){
  if(!task.trim()||busy)return;setBusy(true);setError('');setVerification(null);
  const payload={task:task.trim(),context,screenshot,create_image:image,budget};
  const signature=JSON.stringify(payload);
  if(operation.current?.signature!==signature)operation.current={signature,id:crypto.randomUUID()};
  try{const result=await api<Run>('/api/agent-runs','POST',{id:operation.current.id,...payload});setRun(result);setSelectedFile('');void refreshHistory();}
  catch(e){setError(e instanceof Error?e.message:'Task could not be queued.');}finally{setBusy(false);}
 }
 async function attach(file:File){
  const bitmap=await createImageBitmap(file);try{const ratio=Math.min(1,1280/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*ratio);canvas.height=Math.round(bitmap.height*ratio);canvas.getContext('2d')!.drawImage(bitmap,0,0,canvas.width,canvas.height);setScreenshot(canvas.toDataURL('image/jpeg',0.8));}finally{bitmap.close();}
 }
 async function capture(){
  if(!navigator.mediaDevices?.getDisplayMedia){setError('Screen sharing is unavailable here. Attach a screenshot instead.');return;}
  let stream:MediaStream|undefined;
  try{stream=await navigator.mediaDevices.getDisplayMedia({video:true});const video=document.createElement('video');video.srcObject=stream;await video.play();const canvas=document.createElement('canvas');const ratio=Math.min(1,1280/Math.max(video.videoWidth,video.videoHeight));canvas.width=Math.round(video.videoWidth*ratio);canvas.height=Math.round(video.videoHeight*ratio);canvas.getContext('2d')!.drawImage(video,0,0,canvas.width,canvas.height);setScreenshot(canvas.toDataURL('image/jpeg',0.8));}
  catch{setError('Screen capture did not complete. You can attach a screenshot.');}finally{stream?.getTracks().forEach(track=>track.stop());}
 }
 async function verify(){if(!run||checking)return;setChecking(true);setError('');try{setVerification(await api<Verification>('/api/build/verify','POST',{run_id:run.id,actions:run.state?.artifacts?.browser_actions??[]}));}catch(e){setError(e instanceof Error?e.message:'Checks could not finish.');}finally{setChecking(false);void api<Run>('/api/agent-runs/'+run.id).then(setRun).catch(()=>{});}}
 const files=run?.state?.artifacts?.files??[];
 const file=files.find(f=>f.path===selectedFile)??files[0];
 return <main className="build-team"><header><Link href="/">← Veltra Chat</Link><strong>Veltra Build</strong><Link href="/settings">Credits & settings</Link></header>
 <div className="build-layout"><aside><h1>Give the team a task.</h1><p>DeepSeek plans and reviews. Qwen builds. Visual input and image creation join the task when you choose them.</p>
 <form onSubmit={e=>{e.preventDefault();void submit();}}><label>What should we create?<textarea required maxLength={4000} rows={6} value={task} onChange={e=>setTask(e.target.value)} placeholder="Build a customer follow-up board with working filters and a task form."/></label>
 <details><summary>Project context & connected code</summary><button type="button" disabled={busy} onClick={()=>{setError('');void connectionRequest<{files:{path:string}[]}>('github/tree').then(r=>setRepositoryFiles(r.files.filter(f=>!/(^|\/)(\.env($|\.)|[^/]*\.pem$|id_rsa$|secrets?\.json$)/i.test(f.path)))).catch(e=>setError(e.message));}}>Browse connected repository</button>
 {repositoryFiles.length>0&&<><label>Repository file<select value={repositoryPath} onChange={e=>setRepositoryPath(e.target.value)}><option value="">Choose a file</option>{repositoryFiles.map(f=><option key={f.path}>{f.path}</option>)}</select></label><button type="button" disabled={!repositoryPath||busy} onClick={()=>{void connectionRequest<{path:string;content:string;repository:string}>('github/file?path='+encodeURIComponent(repositoryPath)).then(f=>{setRepository(f.repository);setContext((`Reference file ${f.repository}/${f.path}\n`+f.content).slice(0,8000));}).catch(e=>setError(e.message));}}>Use this file</button></>}
 <label>Reference material<textarea rows={5} maxLength={8000} value={context} onChange={e=>setContext(e.target.value)}/></label>{repository&&<small>{repository}</small>}</details>
 <div className="build-attachments"><label>Attach screenshot<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{const file=e.target.files?.[0];if(file)void attach(file).catch(()=>setError('Screenshot could not be read.'));e.target.value='';}}/></label><button type="button" onClick={()=>void capture()}>Capture screen</button></div>
 {screenshot&&<figure><img src={screenshot} alt="Screenshot reference for this task"/><button type="button" onClick={()=>setScreenshot(null)}>Remove screenshot</button></figure>}
 <label className="build-checkbox"><input type="checkbox" checked={image} onChange={e=>setImage(e.target.checked)}/>Create one image if the code review passes · 100 credits</label>
 <label>Task credit reservation<select value={budget} onChange={e=>setBudget(Number(e.target.value))}><option value={6000}>6,000 credits · small task</option><option value={12000}>12,000 credits · standard task</option><option value={20000}>20,000 credits · larger task</option></select></label><small>Unused credits return after settlement. Interrupted provider calls keep a visible reservation until usage is reconciled.</small>
 <button className="build-primary" disabled={busy||Boolean(active)||!task.trim()}>{busy?'Queuing…':'Start team'}</button></form>
 <button type="button" disabled={busy||Boolean(active)} onClick={()=>{operation.current=null;setRun(null);setVerification(null);setSelectedFile('');setError('');}}>New task</button><h2>Recent tasks</h2>{history.map(item=><button className="build-history" key={item.id} onClick={()=>{setError('');setVerification(null);setSelectedFile('');void api<Run>('/api/agent-runs/'+item.id).then(setRun).catch(e=>setError(e.message));}}><span>{new Date(item.created_at).toLocaleString()}</span><small>{item.status} · {item.credits_used.toLocaleString()} credits</small></button>)}</aside>
 <section className="build-results" aria-live="polite">{error&&<p role="alert" className="build-error">{error}</p>}{!run?<div className="build-welcome"><h2>Plan. Build. Review. Verify.</h2><p>Your files, model receipts, and checks appear here. Repository changes go through the existing code review workflow.</p></div>:<>
 <div className="build-status"><div><h2>{run.status==='completed'?'Team output ready':run.status==='running'?'Team at work':run.status}</h2><p>{run.stage} · {run.credits_used.toLocaleString()} credits used · {run.credits_reserved.toLocaleString()} reserved</p><small>Task {run.id}</small></div>{active&&<button disabled={run.cancel_requested} onClick={()=>{void api('/api/agent-runs/'+run.id+'/cancel','POST').then(()=>setRun({...run,cancel_requested:true})).catch(e=>setError(e.message));}}>{run.cancel_requested?'Stopping at the next safe step…':'Stop task'}</button>}</div>
 {run.error&&<p role="alert" className="build-error">{run.error}</p>}
 {run.state?.observations&&<details><summary>What the team saw</summary><p>{run.state.observations}</p></details>}
 {run.state?.plan&&<details open={!files.length}><summary>Implementation plan</summary><pre>{run.state.plan}</pre></details>}
 {run.state?.review&&<section className="build-review"><h3>{run.state.review.approved?'Model review passed':'Model review needs attention'}</h3><p>{run.state.review.summary}</p>{run.state.review.issues.map((issue,i)=><p key={i}>{issue}</p>)}<small>This is a model review. Run checks to get execution evidence.</small></section>}
 {files.length>0&&<><p>{run.state?.artifacts?.summary}</p><nav className="build-file-tabs" aria-label="Generated files">{files.map(f=><button key={f.path} aria-pressed={file?.path===f.path} onClick={()=>setSelectedFile(f.path)}>{f.path}</button>)}</nav>{file&&<><div className="build-file-toolbar"><strong>{file.path}</strong><button onClick={()=>download(file.path.split('/').pop()!,file.content)}>Download file</button></div><pre className="build-code">{file.content}</pre></>}
 {run.status==='completed'&&<button className="build-primary" disabled={checking||run.verification_status==='completed'||(run.verification_attempts??0)>=2} onClick={()=>void verify()}>{checking?'Running isolated checks…':'Run code checks & browser'}</button>}<p><Link href="/?canvas=code">Open connected code workspace</Link> to review and apply the files.</p></>}
 {run.state?.image&&<figure><img src={run.state.image} alt="Image created for this task"/><a href={run.state.image} download="generated.png">Download project image</a><small>Save as assets/generated.png when referenced by the project.</small></figure>}
 {verification&&<section className="build-review"><h3>{verification.checks_passed?'Checks passed':'Checks need attention'}</h3><small>Receipt {verification.receipt_id}</small>{verification.checks.map((check,i)=><details key={i}><summary>{check.name} · {check.exit_code===0?'passed':'failed'}</summary><pre>{check.stdout}{check.stderr}</pre></details>)}{verification.browser?.errors?.map((message,i)=><p role="alert" key={i}>{message}</p>)}{verification.screenshot&&<img src={verification.screenshot} alt="Browser result after rendering the generated page and running its actions"/>}
 <button onClick={()=>{setContext(JSON.stringify({files,checks:verification.checks,browser:verification.browser}).slice(0,8000));setScreenshot(verification.screenshot??null);setTask('Fix the issues shown in these checks and screenshot. Preserve the working parts.');operation.current=null;}}>Prepare a repair task</button></section>}
 {run.state?.receipts?.length&&<details><summary>Model and tool receipts</summary>{run.state.receipts.map((receipt,i)=><p key={i}>{receipt.role} · {receipt.model} · {receipt.credits} credits{receipt.provider_request_id?' · '+receipt.provider_request_id:''}</p>)}</details>}
 </>}</section></div></main>;
}
