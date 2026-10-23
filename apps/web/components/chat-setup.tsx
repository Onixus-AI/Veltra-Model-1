'use client';
import {useEffect,useRef,useState} from 'react';
import {setupService,type SetupService} from '@/lib/setup-client';
import {FIRST_TASKS,type SetupProfile} from '@/lib/setup-profile';
import {deviceTimeZone} from '@/lib/runtime-context';
import {workspaceModes} from '@/lib/workspace-mode';
import './chat-setup.css';

export default function ChatSetup({busy=false,autoOpen=false,businessReady=false,onContext,onMode,onTool,onStart,service=setupService}:{busy?:boolean;autoOpen?:boolean;businessReady?:boolean;onContext:(profile:SetupProfile)=>void;onMode:(mode:SetupProfile['mode'])=>void;onTool:(tool:'mail'|'crm')=>void;onStart:(prompt:string)=>void;service?:SetupService}){
 const [profile,setProfile]=useState<SetupProfile>(()=>({version:1,phase:'profile',mode:'personal',name:'',business_name:'',goal:'',time_zone:'',timezone_confirmed:false}));
 const [loaded,setLoaded]=useState(false),[loadFailed,setLoadFailed]=useState(false),[expanded,setExpanded]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const lock=useRef(false),opened=useRef(false);
 const context=useRef(onContext);context.current=onContext;
 const mode=useRef(onMode);mode.current=onMode;
 useEffect(()=>{let active=true;void service.load().then(saved=>{if(!active)return;if(saved){setProfile(saved);context.current(saved);if(saved.phase!=='profile'&&!['mode','canvas','crm_workspace'].some(key=>new URLSearchParams(window.location.search).has(key)))mode.current(saved.mode);}else setProfile(current=>({...current,time_zone:deviceTimeZone()??''}));setLoaded(true);}).catch(cause=>{if(active){setError(cause instanceof Error?cause.message:'Setup could not load.');setLoadFailed(true);setLoaded(true);}});return()=>{active=false;};},[service]);
 useEffect(()=>{if(loaded&&autoOpen&&!opened.current&&profile.phase!=='complete'&&!error){opened.current=true;setExpanded(true);}},[loaded,autoOpen,profile.phase,error]);
 function edit(patch:Partial<SetupProfile>){setNotice('');setProfile(current=>({...current,...patch}));}
 async function save(phase:SetupProfile['phase'],close=false,start=false){
  if(lock.current||busy)return;lock.current=true;setSaving(true);setError('');setNotice('');
  try{const saved=await service.save({...profile,phase});setProfile(saved);context.current(saved);onMode(saved.mode);setNotice(start?'Setup saved. Review the request in Chat and send it when you’re ready.':'Saved to your account.');if(close)setExpanded(false);if(start){setExpanded(false);onStart(FIRST_TASKS[saved.mode].prompt);}}
  catch(cause){setError(cause instanceof Error?cause.message:'Setup could not be saved.');}
  finally{lock.current=false;setSaving(false);}
 }
 const disabled=busy||saving||!loaded||loadFailed,task=FIRST_TASKS[profile.mode];
 return <section className="chat-setup" aria-label="Veltra setup">
  <header><div><strong>{profile.phase==='complete'?'Your Veltra setup':'Let’s make Veltra yours'}</strong><span>{loaded?(profile.phase==='complete'?'Preferences saved to your account.':'A few details, then your first useful task.'):'Loading setup…'}</span></div><button type="button" aria-expanded={expanded} disabled={disabled} onClick={()=>setExpanded(!expanded)}>{expanded?'Close setup':profile.phase==='complete'?'Edit setup':'Set up Veltra'}</button></header>
  {error&&<p role="alert">{error} {loadFailed&&<button type="button" disabled={saving||busy} onClick={()=>{setLoaded(false);void service.load().then(saved=>{if(saved){setProfile(saved);context.current(saved);}setError('');setLoadFailed(false);}).catch(cause=>setError(cause.message)).finally(()=>setLoaded(true));}}>Retry loading</button>}</p>}
  {notice&&<p role="status">{notice}</p>}
  {expanded&&<div className="chat-setup-body">
   <ol className="chat-setup-steps" aria-label="Setup progress">{['Your goals','Connections','First task'].map((label,index)=><li key={label} aria-current={(profile.phase==='profile'||profile.phase==='complete'?0:profile.phase==='connections'?1:2)===index?'step':undefined}>{index+1}. {label}</li>)}</ol>
   {(profile.phase==='profile'||profile.phase==='complete')?<form onSubmit={event=>{event.preventDefault();void save('connections');}}>
    <h2>What would you like help with?</h2><fieldset disabled={disabled}>
    <legend className="setup-sr-only">Your preferences</legend>
    <label>Start with<select value={profile.mode} onChange={event=>edit({mode:event.target.value as SetupProfile['mode']})}>{workspaceModes.map(mode=><option key={mode.id} value={mode.id}>{mode.label}</option>)}</select></label>
    <label>What should Veltra help you accomplish?<textarea required maxLength={500} rows={2} value={profile.goal} onChange={event=>edit({goal:event.target.value})} placeholder="For example, keep customer follow-ups organized"/></label>
    <div className="chat-setup-fields"><label>What should we call you? (optional)<input maxLength={80} autoComplete="given-name" value={profile.name} onChange={event=>edit({name:event.target.value})}/></label>{profile.mode==='business'&&<label>Business name (optional)<input maxLength={120} autoComplete="organization" value={profile.business_name} onChange={event=>edit({business_name:event.target.value})}/></label>}</div>
    <label>Timezone<input required maxLength={100} value={profile.time_zone} onChange={event=>edit({time_zone:event.target.value,timezone_confirmed:false})} placeholder="America/New_York" list="veltra-setup-timezones"/></label>
    <datalist id="veltra-setup-timezones">{['America/New_York','America/Chicago','America/Denver','America/Los_Angeles','Europe/London','Europe/Paris','Asia/Dubai','Asia/Kolkata','Asia/Tokyo','Australia/Sydney','UTC'].map(zone=><option key={zone} value={zone}/>)}</datalist>
    <label className="chat-setup-confirm"><input type="checkbox" required checked={profile.timezone_confirmed} onChange={event=>edit({timezone_confirmed:event.target.checked})}/>Use this timezone for my date and time answers.</label>
    </fieldset><p className="chat-setup-note">These details personalize your experience. They don’t grant access to any connected account.</p>
    <footer><button type="button" disabled={disabled} onClick={()=>void save('profile',true)}>Save for later</button><button type="submit" disabled={disabled}>{saving?'Saving…':'Save and continue'}</button></footer>
   </form>:profile.phase==='connections'?<div>
    <h2>Connect only what your first task needs.</h2>
    {profile.mode==='business'?<><p>Open CRM to choose or create your business workspace, then open Mail to connect your inbox. Return here when you’re ready.</p><div className="chat-setup-actions"><button disabled={disabled} onClick={()=>onTool('crm')}>Open CRM</button><button disabled={disabled} onClick={()=>onTool('mail')}>Open Mail</button></div><p>{businessReady?'A business conversation is selected.':'Select a business workspace in CRM before reviewing customer follow-ups.'}</p></>:profile.mode==='dev'?<><p>Connect GitHub and select the repository when you need Veltra to read code. You can plan a project without connecting anything.</p><a href="/settings/connections?mode=dev">Open developer connections</a></>:<p>{profile.mode==='creator'?'A content brief needs no connection. Image creation uses your account credits; publishing needs a supported connection and review.':'You can start planning and writing now. Calendar access and reminders require supported tools; setup does not enable them.'}</p>}
    <p className="chat-setup-note">A connection lets Veltra request supported actions. Existing permissions and action reviews still apply. Email drafts require review; this setup never sends email.</p>
    <footer><button disabled={disabled} onClick={()=>void save('profile')}>Back</button><button disabled={disabled} onClick={()=>void save('connections',true)}>Save for later</button><button disabled={disabled} onClick={()=>void save('ready')}>Continue to first task</button></footer>
   </div>:<div>
    <h2>{task.label}</h2><p>{profile.mode==='business'?'Veltra will read customer records and unanswered quote candidates, show the matching evidence, and ask before preparing mailbox-wide follow-up drafts. Prepared drafts have a separate Mail approval queue. No email is sent by this task.':'Veltra will ask for the details it needs and prepare the work with you. Results will appear in Chat.'}</p>
    {profile.mode==='business'&&!businessReady&&<p>Select a business conversation first. <button disabled={disabled} onClick={()=>onTool('crm')}>Choose a business workspace</button></p>}
    <p className="chat-setup-note">Saving setup does not complete a task. Check the task’s results and receipts in Chat.</p>
    <footer><button disabled={disabled} onClick={()=>void save('connections')}>Back</button><button disabled={disabled} onClick={()=>void save('ready',true)}>Save for later</button><button disabled={disabled||(profile.mode==='business'&&!businessReady)} onClick={()=>void save('complete',false,true)}>Save setup and open task</button></footer>
   </div>}
  </div>}
 </section>;
}
