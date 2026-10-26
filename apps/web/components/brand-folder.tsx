'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {gatewayAuthorizationHeaders} from '@/lib/client-session';
type FileItem={id:string;name:string;size:number;deleted_at:string|null};
const size=(n:number)=>n>=1048576?`${(n/1048576).toFixed(1)} MB`:`${Math.ceil(n/1024)} KB`;
export default function BrandFolder(){
 const [files,setFiles]=useState<FileItem[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[trash,setTrash]=useState(false);
 async function api(path:string,body?:object){const response=await fetch('/api/brand/'+path,{method:body?'POST':'GET',headers:{...await gatewayAuthorizationHeaders(),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,cache:'no-store'});if(!response.ok){const data=await response.json().catch(()=>({}));throw Error(data.error||'Brand folder request failed.');}return response;}
 async function load(){try{const response=await api('files');setFiles((await response.json()).files);setError('');}catch(e){setError((e as Error).message);}}
 useEffect(()=>{void load();},[]);
 async function upload(file:File){setBusy(true);setError('');try{if(file.size>3145728)throw Error('Please choose a file no larger than 3 MB.');const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('Could not read file.'));reader.readAsDataURL(file);});await api('upload',{name:file.name,data});await load();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function action(file:FileItem,operation:string){setBusy(true);setError('');try{if(operation==='download'){const blob=await(await api('download?id='+encodeURIComponent(file.id))).blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}else{await api(operation,{id:file.id});await load();}}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <main style={{maxWidth:1100,margin:'0 auto',padding:'40px 24px',color:'var(--foreground, inherit)'}}>
  <nav style={{display:'flex',gap:20,marginBottom:28}}><Link href="/workspace">Workspace</Link><Link href="/workspace/files">Docs &amp; Sheets</Link></nav>
  <h1 style={{fontSize:32,fontWeight:700}}>Brand folder</h1><p style={{margin:'12px 0 28px',opacity:.7}}>Your logos, brand guidelines, and marketing files in one place.</p>
  {error&&<p role="alert" style={{padding:16,border:'1px solid #c95656',borderRadius:12,marginBottom:20}}>{error}</p>}
  <section style={{padding:24,border:'1px solid #7775',borderRadius:16,marginBottom:32}} aria-labelledby="my-brand"><h2 id="my-brand" style={{fontSize:22,fontWeight:600}}>My brand files</h2>
   <p style={{opacity:.7,margin:'10px 0 20px'}}>Private to your signed-in account. Upload images, PDFs, Office documents, ZIPs, or text files. Up to 3 MB per file, 200 files and 50 MB total, including Trash.</p>
   <label style={{display:'inline-block',padding:'10px 16px',border:'1px solid #7778',borderRadius:8,cursor:busy?'wait':'pointer'}}>Upload file<input type="file" disabled={busy} accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.zip,.txt,.md,.csv,.json,.docx,.xlsx,.pptx" style={{display:'block',marginTop:8}} onChange={e=>{const file=e.target.files?.[0];if(file)void upload(file);e.target.value='';}}/></label>
   <div style={{display:'flex',gap:16,margin:'24px 0 12px'}}><button aria-pressed={!trash} onClick={()=>setTrash(false)}>Files ({files.filter(f=>!f.deleted_at).length})</button><button aria-pressed={trash} onClick={()=>setTrash(true)}>Trash ({files.filter(f=>f.deleted_at).length})</button><button disabled={busy} onClick={()=>void load()}>Refresh</button></div>
   <ul>{files.filter(f=>Boolean(f.deleted_at)===trash).map(file=><li key={file.id} style={{display:'flex',gap:14,alignItems:'center',borderTop:'1px solid #7774',padding:'14px 0',flexWrap:'wrap'}}><span style={{flex:1,overflowWrap:'anywhere'}}>{file.name} <small style={{opacity:.6}}>{size(file.size)}</small></span>{!trash&&<button disabled={busy} onClick={()=>void action(file,'download')}>Download</button>}<button disabled={busy} onClick={()=>void action(file,trash?'restore':'remove')}>{trash?'Restore':'Move to Trash'}</button></li>)}</ul>
   {!files.some(f=>Boolean(f.deleted_at)===trash)&&<p style={{opacity:.6,padding:'20px 0'}}>{trash?'Trash is empty.':'Upload your first brand file.'}</p>}
  </section>

 </main>;
}
