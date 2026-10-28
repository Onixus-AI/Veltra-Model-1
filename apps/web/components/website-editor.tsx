'use client';
import {Puck,Render,type Config,type Data} from '@puckeditor/core';
import '@puckeditor/core/puck.css';
import Link from 'next/link';
import WorkspaceAppearance from '@/components/workspace-appearance';
import {useMemo,useRef,useState} from 'react';
import WebsiteOnyx from '@/components/website-onyx';
import {HTML_IMPORT_LIMIT,importedHtmlPreview,readHtmlFile} from '@/lib/website-html';
import {exportWebsite,readWebsiteData,safeSiteLink,starterWebsite,websiteStyles,type SiteBlock} from '@/lib/website-document';
import './website-editor.css';
type Fields=Omit<SiteBlock['props'],'id'>;
type Components={Hero:Fields;Features:Fields;Story:Fields;Offer:Fields;Footer:Fields};
const fields={title:{type:'text' as const},body:{type:'textarea' as const},action:{type:'text' as const,label:'Button label'},href:{type:'text' as const,label:'HTTPS link or #section'}};
const config:Config<Components,{title:string}>={
 root:{fields:{title:{type:'text',label:'Website name'}},render:({children,title})=><div className="onixus-site"><style>{websiteStyles}</style><nav className="site-nav" aria-label="Main navigation"><strong>{title}</strong><a href="#contact">Contact</a></nav><main>{children}</main></div>},
 components:{
  Hero:{fields,defaultProps:{title:'Make your next move.',body:'Describe the outcome your audience can expect.',action:'Discover more',href:'#features'},render:({title,body,action,href,id})=><section id={id} className="site-hero"><h1>{title}</h1><p>{body}</p>{action&&<a className="site-cta" href={safeSiteLink(href)}>{action}</a>}</section>},
  Features:{fields,defaultProps:{title:'Considered from every angle.',body:'First benefit\nSecond benefit\nThird benefit',action:'',href:'#contact'},render:({title,body,id})=><section id={id} className="site-features"><h2>{title}</h2><div className="site-feature-grid">{body.split('\n').filter(Boolean).map((line,index)=><article key={index}>{line}</article>)}</div></section>},
  Story:{fields,defaultProps:{title:'A clearer way forward.',body:'Tell your story with specific benefits and real evidence.',action:'',href:'#contact'},render:({title,body,action,href,id})=><section id={id} className="site-story"><h2>{title}</h2><div><p>{body}</p>{action&&<a className="site-cta" href={safeSiteLink(href)}>{action}</a>}</div></section>},
  Offer:{fields,defaultProps:{title:'Start a conversation.',body:'Add your real contact or booking link.',action:'Get in touch',href:'#contact'},render:({title,body,action,href,id})=><section id={id} className="site-offer"><h2>{title}</h2><p>{body}</p>{action&&<a className="site-cta" href={safeSiteLink(href)}>{action}</a>}</section>},
  Footer:{fields,defaultProps:{title:'Your studio',body:'Add real contact details and legal information before publishing.',action:'',href:'#contact'},render:({title,body,id})=><footer id={id}><strong>{title}</strong><p>{body}</p></footer>},
 },
};
function download(name:string,content:string,type:string){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export default function WebsiteEditor(){
 const [data,setData]=useState<Data>(starterWebsite),[preview,setPreview]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 const input=useRef<HTMLInputElement>(null),htmlInput=useRef<HTMLInputElement>(null);
 const [htmlSource,setHtmlSource]=useState<string|null>(null),[htmlName,setHtmlName]=useState('website.html'),[onyxBusy,setOnyxBusy]=useState(false),[previousSource,setPreviousSource]=useState<string|null>(null);
 const currentSource=htmlSource??exportWebsite(data);
 const htmlPreview=useMemo(()=>htmlSource===null?'':importedHtmlPreview(htmlSource),[htmlSource]);
 function acceptOnyx(html:string){setPreviousSource(currentSource);setHtmlSource(html);setHtmlName('website.html');setPreview(true);setNotice('Onyx returned an HTML revision. Review it below; your previous HTML is available with Undo Onyx revision.');}
 async function importHtml(file?:File){if(!file)return;try{if(file.size>HTML_IMPORT_LIMIT)throw Error('Choose an HTML file smaller than 250 KB.');const html=readHtmlFile(file.name,await file.text());setHtmlSource(html);setHtmlName(file.name);setPreviousSource(null);setPreview(true);setError('');setNotice('HTML opened locally. Edit the source or ask Onyx for changes. Download it to keep your work.');}catch(e){setError(e instanceof Error?e.message:'HTML could not be opened.');}finally{if(htmlInput.current)htmlInput.current.value='';}}
 function exportFile(format:'html'|'json'){
  try{if(htmlSource!==null){if(format==='json')throw Error('Imported HTML is exported as HTML, not a visual-editor project.');download(htmlName,htmlSource,'text/html');setNotice('HTML download prepared. Your original scripts and references are preserved in the exported file.');setError('');return;}const clean=readWebsiteData(data);download(format==='html'?'website.html':'website.onixus.json',format==='html'?exportWebsite(clean):JSON.stringify(clean,null,2),format==='html'?'text/html':'application/json');setError('');setNotice('Download prepared. This does not publish or save the website to Workspace.');}catch(e){setError(e instanceof Error?e.message:'Website export failed.');}
 }
 async function importFile(file?:File){
  if(!file)return;
  try{if(file.size>250000)throw Error('Choose a project smaller than 250 KB.');const next=readWebsiteData(JSON.parse(await file.text()));setData(next);setHtmlSource(null);setPreviousSource(null);setRevision(n=>n+1);setError('');setNotice('Project opened in this editor. Download your project to keep your changes.');}catch(e){setError(e instanceof Error?e.message:'Project could not be opened.');}finally{if(input.current)input.current.value='';}
 }
 return <main className="website-studio">
  <header className="website-toolbar"><Link href="/">Onixus Workspace</Link><h1><img src="/brands/onixus-websites-icon-v1.png" alt="" width={32} height={32}/>Website builder</h1><nav aria-label="Website actions"><button onClick={()=>setPreview(v=>!v)}>{preview?(htmlSource!==null?'Edit HTML':'Edit website'):'Preview'}</button><button disabled={onyxBusy} onClick={()=>input.current?.click()}>Open project</button><button disabled={onyxBusy} onClick={()=>htmlInput.current?.click()}>Import HTML</button><button disabled={htmlSource!==null} onClick={()=>exportFile('json')}>Download project</button><WorkspaceAppearance/><button onClick={()=>exportFile('html')}>Export HTML</button></nav></header>
  <input ref={input} type="file" accept="application/json,.json" hidden onChange={e=>void importFile(e.target.files?.[0])}/>
  <input ref={htmlInput} type="file" accept=".html,.htm,text/html" hidden onChange={e=>void importHtml(e.target.files?.[0])}/>
  <div className="website-notice"><p>Included in Personal, Creator, Dev and Business. Edit sections, preview and export a draft. Full-site AI generation requires sufficient wallet credits; optional top-ups are separate. Changes stay in this editor until you download them. Hosting, custom domains and cloud saving are not connected here yet.</p><a href="#website-onyx-title">Ask Onyx to build or revise</a></div>
  {notice&&<p className="website-message" role="status">{notice}</p>}{error&&<p className="website-message" role="alert">{error}</p>}
  <WebsiteOnyx source={currentSource} onResult={acceptOnyx} onBusy={setOnyxBusy}/>
  {htmlSource!==null?<section className="website-html-editor" aria-label="Imported HTML website"><header><h2>{htmlName}</h2><p>Safe static preview: scripts, forms, navigation and external files are disabled here. Export preserves your original HTML. HTML is edited as code, not converted into blocks.</p>{previousSource!==null&&<button disabled={onyxBusy} onClick={()=>{setHtmlSource(previousSource);setPreviousSource(null);setNotice('Previous HTML restored in this editor.');}}>Undo Onyx revision</button>}</header>{preview?<iframe title="Imported HTML preview" sandbox="" referrerPolicy="no-referrer" srcDoc={htmlPreview}/>:<textarea aria-label="Website HTML source" value={htmlSource} maxLength={250000} spellCheck={false} disabled={onyxBusy} onChange={e=>setHtmlSource(e.target.value)}/>}</section>:preview?<div className="website-preview"><Render config={config} data={data}/></div>:<div inert={onyxBusy} aria-busy={onyxBusy}><Puck key={revision} config={config} data={data} onChange={next=>{if(!onyxBusy){setData(next);setNotice('');}}} headerTitle="Onixus websites" permissions={{publish:false}} renderHeaderActions={()=><span>Draft editor</span>}/></div>}
 </main>;
}
