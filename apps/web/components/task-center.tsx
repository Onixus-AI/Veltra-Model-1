'use client';
import {useEffect,useId,useState,type ReactNode} from 'react';
import {Check,ChevronDown,Clock3,Loader2,ShieldCheck,Square,X,ArrowUpRight} from 'lucide-react';
import ToolLogo from './tool-logo';
import type {TaskRun} from '@/lib/task-progress';
import './task-center.css';
const names={running:'Working',permission:'Needs permission',review:'Needs review',completed:'Completed',failed:'Needs attention',cancelled:'Stopped',skipped:'Skipped'};
const EXPANSION_KEY='veltra-task-center-expanded-v1';
export default function TaskCenter({task,busy,onStop,onRetry,onOpen,onFollowups,canFollowup,activity}:{task:TaskRun|null;busy:boolean;onStop:()=>void;onRetry:()=>void;onOpen:(app:'mail'|'crm')=>void;onFollowups:()=>void;canFollowup:boolean;activity?:ReactNode}){
 const [expanded,setExpanded]=useState(false),detailsId=useId();
 useEffect(()=>{try{setExpanded(localStorage.getItem(EXPANSION_KEY)==='true');}catch{}},[]);
 function toggle(){setExpanded(current=>{try{localStorage.setItem(EXPANSION_KEY,String(!current));}catch{}return !current;});}
 return <section className="task-center task-center-compact" aria-label="Veltra task center">
  <header className="task-center-bar">
   <div className="task-center-heading"><Clock3 size={15}/><h2>Task center</h2>{task&&<span className={'task-state '+task.state} role="status">{names[task.state]}</span>}</div>
   <div className="task-center-controls">{busy&&<button className="task-stop" type="button" onClick={onStop} aria-label="Stop pending work"><Square size={12}/>Stop</button>}<button className="task-expand" type="button" onClick={toggle} aria-expanded={expanded} aria-controls={detailsId} aria-label={expanded?'Collapse task center':'Expand task center'}>{expanded?'Collapse':'Expand'}<ChevronDown size={15} className={expanded?'is-expanded':''}/></button></div>
  </header>
  {expanded&&<div id={detailsId} className="task-center-details">
   {!busy&&<div className="task-center-actions"><button type="button" disabled={!canFollowup} onClick={onFollowups}>Prepare follow-ups<ArrowUpRight size={14}/></button>{!task&&<span>{canFollowup?'Review unanswered quotes and draft preparation.':'Choose a business conversation to review follow-ups.'}</span>}</div>}
   {task&&<>
    <p className="task-purpose">{task.purpose}</p>
    {task.note&&<p className="task-note">{task.note}</p>}
    {task.steps.length>0&&<details open><summary><ChevronDown size={14}/>{task.steps.filter(s=>s.state==='completed').length} of {task.steps.length} {task.omitted?'displayed ':''}steps completed{task.omitted?` · ${task.omitted} earlier steps hidden`:''}</summary><ol>{task.steps.map(step=><li key={step.id} className={'task-step '+step.state}><span className="task-step-icon">{step.state==='completed'?<Check size={15}/>:step.state==='failed'?<X size={15}/>:step.state==='running'?<Loader2 size={15}/>:step.state==='review'||step.state==='permission'?<ShieldCheck size={15}/>:<Square size={13}/>}</span><div><div className="task-step-title"><strong>{step.title}</strong><small>{['GitHub','Vercel','Supabase','Railway','n8n'].includes(step.app)&&<ToolLogo name={step.app}/>} {step.app} · {names[step.state]}</small></div>{step.detail&&<details><summary>View {step.state==='review'?'review':'result'}</summary><pre>{step.detail}</pre></details>}</div></li>)}</ol></details>}
    <footer>{!busy&&(task.state==='failed'||task.state==='cancelled')&&<button type="button" onClick={onRetry}>Review request again</button>}{task.steps.some(s=>s.app==='Mail')&&<button type="button" onClick={()=>onOpen('mail')}>Open Mail<ArrowUpRight size={14}/></button>}{task.steps.some(s=>s.app==='CRM')&&<button type="button" onClick={()=>onOpen('crm')}>Open CRM<ArrowUpRight size={14}/></button>}</footer>
    {!busy&&(task.state==='failed'||task.state==='cancelled')&&<p className="task-note">Review results before starting a new request. Actions are never retried automatically.</p>}
   </>}
   {activity}
  </div>}
 </section>;
}
