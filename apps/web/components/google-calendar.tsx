'use client';
import Link from 'next/link';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {gatewayAuthorizationHeaders} from '@/lib/client-session';
import {formatInZone,type NotificationPlan} from '@/lib/revenue/workspace-calendar';
import {defaultEventZone,emptyForm,formWhen,normalizeZone,setWhen,splitLocal,zoneOptions,type EventForm} from '@/lib/revenue/calendar-form';

type Health={status:string;error:string|null;at:string};
export type CalendarStatus={configured:boolean;crm_configured:boolean;connected:boolean;account:{email:string|null};scopes:string[];missing_scopes:string[];workspace_id:string|null;crm_linked:boolean;health:Health|null;callback_url:string;setup_required:string[]};
type Workspace={id:string;name:string;environment:string;role:string};
type CrmCalendar={calendar_id:string;summary:string|null;time_zone:string|null;access_role:string|null;primary:boolean;available:boolean;sync_enabled:boolean;write_default:boolean;status:string|null;last_synced_at:string|null;last_error:string|null;events_synced:number};
type CrmConnection={id:string;google_email:string|null;status:string;last_error:string|null;last_synced_at:string|null;next_attempt_at:string|null;share_meetings:boolean;user_timezone:string|null;linked:boolean;calendars:CrmCalendar[]};
type CalendarEvent={id:string;status:string;title:string;description:string;location:string;all_day:boolean;start:string|null;end:string|null;start_date:string|null;end_date:string|null;time_zone:string|null;organizer_email:string|null;organizer_self:boolean;attendees:{email:string;self:boolean;response_status:string|null}[];recurring:boolean;html_link:string|null;can_edit:boolean};
export type CalendarReview={ticket:string;action:'create'|'update'|'cancel';account:{email:string};calendar_id:string;title:string;when:{all_day:boolean;start?:string;end?:string;start_date?:string;end_date?:string;time_zone?:string|null}|null;plan:NotificationPlan;warnings:string[]};

const STATE='onixus-google-calendar-state';
const problems:Record<string,string>={expired:'Google Calendar access expired.',revoked:'Google Calendar access was revoked or expired at Google.',scope_missing:'Google Calendar permissions were not fully granted.',api_disabled:'The Google Calendar API is not enabled for Onixus Workspace yet.',error:'The last calendar sync failed. Onixus Workspace retries automatically.',unlinked:'This calendar is no longer linked to Onixus CRM.'};
const returns:Record<string,string>={connected:'Google Calendar connected.',connected_limited:'Google Calendar connected. Only your primary calendar is available because calendar-list access was not granted.',scope_missing:'Google did not grant access to calendar events. Connect again and allow the Calendar permissions.',cancelled:'Google Calendar connection cancelled. Your existing connection, if any, still works.',expired:'This connection attempt expired. Start again.',failed:'Google Calendar could not finish connecting. Try again.'};
async function mail<T>(path:string,method='GET',body?:object):Promise<T>{const response=await fetch(`/api/google-calendar/${path}`,{method,headers:{...await gatewayAuthorizationHeaders(),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,cache:'no-store'});const data=await response.json();if(!response.ok)throw Object.assign(Error(data.error??'Google Calendar request failed.'),{code:data.code});return data;}
async function crm<T>(path:string,body?:object):Promise<T>{const response=await fetch(`/api/revenue/${path}`,{method:body?'POST':'GET',headers:{...await gatewayAuthorizationHeaders(),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,cache:'no-store'});const data=await response.json();if(!response.ok)throw Error(data.error??'Onixus CRM request failed.');return data;}
/** Wall-clock "YYYY-MM-DDTHH:MM" in a zone, for the date and time inputs. */
export function localInput(utc:string,tz:string){return new Intl.DateTimeFormat('sv-SE',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(utc)).replace(' ','T');}
const browserZone=()=>normalizeZone(Intl.DateTimeFormat().resolvedOptions().timeZone)??'UTC';
const zones=()=>{try{return (Intl as unknown as {supportedValuesOf(k:string):string[]}).supportedValuesOf('timeZone');}catch{return [];}};
export function describeWhen(when:CalendarReview['when']){if(!when)return '';if(when.all_day)return when.start_date===when.end_date?`${when.start_date} (all day)`:`${when.start_date} to ${when.end_date} (all day)`;return `${formatInZone(when.start!,when.time_zone??'UTC')} until ${formatInZone(when.end!,when.time_zone??'UTC')}`;}

/** The last step before Google emails anyone: each address must be ticked. */
export function CalendarReviewDialog({review,busy,onConfirm,onBack}:{review:CalendarReview;busy:boolean;onConfirm:(confirmed:string[])=>void;onBack:()=>void}){
 const [ticked,setTicked]=useState<string[]>([]);
 const everyone=review.plan.notified,all=everyone.every(e=>ticked.includes(e));
 const verb={create:'Create',update:'Save changes to',cancel:'Cancel'}[review.action];
 return <article className="rounded border p-4 space-y-3" role="dialog" aria-label="Review calendar change">
  <h3 className="font-semibold">{verb} “{review.title}” in {review.account.email}?</h3>
  <p>{describeWhen(review.when)}{review.calendar_id!=='primary'&&<> · Calendar {review.calendar_id}</>}</p>
  {everyone.length?<fieldset className="space-y-1"><legend className="font-medium">Google will email {everyone.length===1?'this person':`these ${everyone.length} people`}{review.action==='cancel'?' a cancellation':review.action==='create'?' an invitation':' an update'}:</legend>
   {everyone.map(email=><label key={email} className="block"><input type="checkbox" checked={ticked.includes(email)} onChange={e=>setTicked(t=>e.target.checked?[...t,email]:t.filter(x=>x!==email))}/> {email}{review.plan.removed.includes(email)?' (removed, gets a cancellation)':review.plan.added.includes(email)&&review.action==='update'?' (new guest)':''}</label>)}
  </fieldset>:<p>Nobody will be emailed.</p>}
  {review.warnings.map(w=><p key={w} className="text-sm" role="note">{w}</p>)}
  <button className="google-primary rounded border px-4 py-2" disabled={busy||!all} onClick={()=>onConfirm(everyone)}>{everyone.length?`${verb} and email ${everyone.length===1?'1 person':`${everyone.length} people`}`:`${verb} without emailing anyone`}</button>
  <button className="ml-4" onClick={onBack}>Back</button>
  <p className="text-sm opacity-70">If saving times out, check Google Calendar before trying again so nobody is invited twice.</p>
 </article>;
}

/**
 * Date and time inputs stay uncontrolled while focused: browsers report "" for a half-typed
 * value, and writing that back would wipe what the person is typing. Unfocused inputs follow the
 * form, so the end can track the start and a reset clears everything.
 */
function WhenInput({label,type,value,onValue}:{label:string;type:'date'|'time';value:string;onValue:(v:string)=>void}){
 const ref=useRef<HTMLInputElement>(null);
 useEffect(()=>{const el=ref.current;if(el&&el.ownerDocument.activeElement!==el&&el.value!==value)el.value=value;},[value]);
 const read=(e:{currentTarget:HTMLInputElement})=>{if(e.currentTarget.value!==value)onValue(e.currentTarget.value);};
 return <label>{label}<input ref={ref} required type={type} aria-label={label} className="block rounded border bg-transparent p-2" defaultValue={value} min={type==='date'?'1900-01-01':undefined} max={type==='date'?'2200-12-31':undefined} onChange={read} onBlur={read}/></label>;
}

export function EventWhenFields({form,zones,onChange}:{form:EventForm;zones:string[];onChange:(f:EventForm)=>void}){
 const options=useMemo(()=>zoneOptions(zones,[form.time_zone]),[zones,form.time_zone]);
 return <>
  <label className="block"><input type="checkbox" checked={form.all_day} onChange={e=>onChange({...form,all_day:e.target.checked})}/> All day</label>
  <div className="flex flex-wrap gap-3">
   <WhenInput label="Start date" type="date" value={form.start_date} onValue={v=>onChange(setWhen(form,'start_date',v))}/>
   {!form.all_day&&<WhenInput label="Start time" type="time" value={form.start_time} onValue={v=>onChange(setWhen(form,'start_time',v))}/>}
   <WhenInput label="End date" type="date" value={form.end_date} onValue={v=>onChange(setWhen(form,'end_date',v))}/>
   {!form.all_day&&<WhenInput label="End time" type="time" value={form.end_time} onValue={v=>onChange(setWhen(form,'end_time',v))}/>}
   {!form.all_day&&<label>Time zone<select className="block rounded border bg-transparent p-2" aria-label="Time zone" value={form.time_zone} onChange={e=>onChange({...form,time_zone:e.target.value,zone_chosen:true})}>{options.map(z=><option key={z} value={z}>{z}</option>)}</select></label>}
  </div>
 </>;
}

export default function GoogleCalendarPanel({embedded=false}:{embedded?:boolean}={}){
 const [status,setStatus]=useState<CalendarStatus|null>(null),[workspaces,setWorkspaces]=useState<Workspace[]>([]),[w,setW]=useState(''),[link,setLink]=useState<CrmConnection|null>(null);
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const [calendar,setCalendar]=useState('primary'),[events,setEvents]=useState<CalendarEvent[]>([]),[editing,setEditing]=useState<string|null>(null),[draft,setDraft]=useState<EventForm>(()=>emptyForm('UTC')),[notify,setNotify]=useState(false),[review,setReview]=useState<CalendarReview|null>(null);
 const zoneList=useMemo(zones,[]);
 const refresh=useCallback(async()=>{
  const s=await mail<CalendarStatus>('status');setStatus(s);
  const list=(await crm<{workspaces:Workspace[]}>('workspaces')).workspaces;setWorkspaces(list);
  const chosen=s.workspace_id&&list.some(x=>x.id===s.workspace_id)?s.workspace_id:list.find(x=>x.role!=='viewer')?.id??list[0]?.id??'';setW(chosen);
  setLink(chosen&&s.connected?(await crm<{connections:CrmConnection[]}>(`calendar?w=${chosen}`)).connections[0]??null:null);
 },[]);
 const loadEvents=useCallback(async(id:string)=>{const from=new Date(),to=new Date(Date.now()+14*86_400_000);setEvents((await mail<{events:CalendarEvent[]}>(`events?${new URLSearchParams({calendar:id,from:from.toISOString(),to:to.toISOString()})}`)).events);},[]);
 useEffect(()=>{void refresh().catch(e=>setError(e.message));const q=new URLSearchParams(location.search),result=q.get('calendar');if(result){const expected=sessionStorage.getItem(STATE);sessionStorage.removeItem(STATE);if(!expected||q.get('state')!==expected)setError('This Google Calendar connection started in another browser session. Check the status below.');else if(result.startsWith('connected'))setNotice(returns[result]);else setError(returns[result]??returns.failed);history.replaceState(null,'','/settings/calendar');}},[refresh]);
 useEffect(()=>{if(status?.connected&&!problemOf(status,link))void loadEvents(calendar).catch(e=>setError(e.message));},[status,link,calendar,loadEvents]);
 async function act(work:()=>Promise<void>){setBusy(true);setError('');setNotice('');try{await work();}catch(e){setError(e instanceof Error?e.message:'Request failed.');}finally{setBusy(false);}}
 const connect=()=>act(async()=>{if(!w)throw Error('Choose an Onixus CRM workspace first.');const browser=crypto.randomUUID();sessionStorage.setItem(STATE,browser);const {url}=await mail<{url:string}>('start','POST',{browser,workspace_id:w});if(new URL(url).protocol!=='https:')throw Error('Invalid authorization URL.');location.assign(url);});
 const problem=problemOf(status,link),role=workspaces.find(x=>x.id===w)?.role,writable=(link?.calendars??[]).filter(k=>k.access_role==='owner'||k.access_role==='writer');
 const select=(k:CrmCalendar,change:{p_sync?:boolean;p_write_default?:boolean})=>act(async()=>{await crm('rpc/revenue_calendar_select',{workspace_id:w,args:{p_calendar:k.calendar_id,...change}});await refresh();});
 const writeTo=writable.find(k=>k.write_default)?.calendar_id??'primary';
 const calendarZone=(id:string)=>(link?.calendars??[]).find(k=>k.calendar_id===id||id==='primary'&&k.primary)?.time_zone;
 const newZone=defaultEventZone({user:link?.user_timezone,calendar:calendarZone(writeTo),browser:browserZone()});
 const blank=()=>emptyForm(newZone);
 useEffect(()=>{if(!editing)setDraft(d=>d.zone_chosen||d.time_zone===newZone?d:{...d,time_zone:newZone});},[editing,newZone]);
 const startEdit=(e:CalendarEvent)=>{const tz=normalizeZone(e.time_zone)??defaultEventZone({user:link?.user_timezone,calendar:calendarZone(calendar),browser:browserZone()});const s=e.all_day?{date:e.start_date!,time:''}:splitLocal(localInput(e.start!,tz)),t=e.all_day?{date:e.end_date!,time:''}:splitLocal(localInput(e.end!,tz));
  setEditing(e.id);setReview(null);setNotify(false);setDraft({title:e.title,description:e.description,location:e.location,all_day:e.all_day,start_date:s.date,start_time:s.time,end_date:t.date,end_time:t.time,time_zone:tz,zone_chosen:true,end_chosen:true,attendees:e.attendees.filter(a=>!a.self).map(a=>a.email).join(', ')});};
 const body=(d:EventForm)=>{const when=formWhen(d);if(when.error!==undefined)throw Error(when.error);return {title:d.title,description:d.description,location:d.location,all_day:d.all_day,start:when.start,end:when.end,time_zone:d.time_zone,attendees:d.attendees.split(/[\s,;]+/).filter(Boolean)};};
 const guests=draft.attendees.split(/[\s,;]+/).some(Boolean);
 const Surface=embedded?'section':'main';
 return <Surface className="google-files-panel mx-auto max-w-5xl space-y-6 p-6">
 {!embedded&&<Link href="/workspace">← Workspace</Link>}<header><h1 className="text-3xl font-semibold">Google Calendar</h1><p className="mt-2 opacity-70">See your meetings, create and change events after reviewing who Google will email, and add meetings with customers to Onixus CRM.</p></header>
 {error&&<p role="alert" className="rounded border border-red-500 p-3">{error}</p>}{notice&&<p role="status" className="rounded border p-3">{notice}</p>}
 <section className="rounded-xl border p-5 space-y-3" aria-label="Google Calendar connection">
  <h2 className="text-xl font-semibold">{status?.connected?`Calendar account: ${status.account.email}`:'Connect Google Calendar'}</h2>
  <p>{status?.connected?'Connected for your Onixus Workspace user only. Separate from your Mail inbox and your Drive connection, even when they use the same Google account.':'Google will ask to see and edit events in your calendars and to see your calendar list. Onixus Workspace never sends invitations without your review.'}</p>
  {status&&(!status.configured||!status.crm_configured)&&<p>Setup required: {status.setup_required.join(', ')}. Register callback: <code>{status.callback_url}</code></p>}
  {problem&&<div role="alert" className="rounded border border-amber-500 p-3"><p className="font-medium">{problem}</p>{(link?.last_error||status?.health?.error)&&<p className="text-sm">{link?.last_error??status?.health?.error}</p>}<button className="google-primary mt-2 rounded border px-4 py-2" disabled={busy||!status?.configured} onClick={()=>void connect()}>Reconnect Google Calendar</button></div>}
  {status?.connected&&!!status.missing_scopes.length&&!problem&&<p className="text-sm">Only your primary calendar is available. Reconnect and allow calendar-list access to choose other calendars.</p>}
  <label className="block">Onixus CRM workspace<select className="ml-3 rounded border bg-transparent p-2" value={w} disabled={busy||status?.connected} onChange={e=>setW(e.target.value)}>{workspaces.length?workspaces.map(x=><option key={x.id} value={x.id} disabled={x.role==='viewer'}>{x.name}{x.environment!=='production'?` (${x.environment})`:''}{x.role==='viewer'?' (view only)':''}</option>):<option value="">No workspace</option>}</select></label>
  {role==='viewer'&&!status?.connected&&<p className="text-sm">Viewers cannot add meetings to this workspace. Ask an owner for member access.</p>}
  <div className="flex gap-3"><button className="google-primary rounded border px-4 py-2" disabled={busy||!status?.configured||!status.crm_configured||!w||role==='viewer'} onClick={()=>void connect()}>{status?.connected?'Reconnect':'Connect Google Calendar'}</button>
  {status?.connected&&<button className="rounded border px-4 py-2" disabled={busy} onClick={()=>void act(async()=>{await mail('disconnect','DELETE');setEvents([]);setReview(null);await refresh();setNotice('Google Calendar disconnected from Onixus Workspace. Meetings already in Onixus CRM stay. To remove the grant at Google, use your Google Account’s third-party access page.');})}>Disconnect</button>}
  {status?.connected&&link&&<button className="rounded border px-4 py-2" disabled={busy} onClick={()=>void act(async()=>{const r=await mail<{status:string;calendars:{ingested:number}[]}>('sync','POST',{});await refresh();setNotice(r.status==='healthy'?`Synced. ${r.calendars.reduce((n,c)=>n+c.ingested,0)} meeting updates sent to Onixus CRM.`:problems[r.status]??'Sync finished with problems.');})}>Sync now</button>}</div>
  {link?.last_synced_at&&<p className="text-sm opacity-70">Last synced {new Date(link.last_synced_at).toLocaleString()}</p>}
 </section>
 {status?.connected&&link&&<section className="rounded-xl border p-5 space-y-4" aria-label="Calendars and CRM">
  <h2 className="text-xl font-semibold">Calendars</h2>
  <p className="text-sm">Meetings with people who are customers in this workspace appear on their Onixus CRM timeline. Only you can see or change these settings.</p>
  <table className="w-full text-left"><thead><tr><th>Calendar</th><th>Time zone</th><th>Add meetings to CRM</th><th>New events go here</th></tr></thead><tbody>
   {link.calendars.map(k=><tr key={k.calendar_id} className={k.available?'':'opacity-50'}><td>{k.summary??k.calendar_id}{k.primary?' (primary)':''}{k.last_error&&<small className="block">{k.last_error}</small>}</td><td>{k.time_zone??'—'}</td>
    <td><input type="checkbox" aria-label={`Add meetings from ${k.summary??k.calendar_id} to CRM`} checked={k.sync_enabled} disabled={busy||!k.available} onChange={e=>void select(k,{p_sync:e.target.checked})}/></td>
    <td><input type="radio" name="write-default" aria-label={`Create new events in ${k.summary??k.calendar_id}`} checked={k.write_default} disabled={busy||!k.available||!(k.access_role==='owner'||k.access_role==='writer')} onChange={()=>void select(k,{p_write_default:true})}/></td></tr>)}
  </tbody></table>
  <label className="block"><input type="checkbox" checked={link.share_meetings} disabled={busy} onChange={e=>void act(async()=>{await crm('rpc/revenue_calendar_settings',{workspace_id:w,args:{p_share:e.target.checked}});await refresh();})}/> Share meeting titles and times with my teammates on customer timelines</label>
  <label className="block">My time zone<select className="ml-3 rounded border bg-transparent p-2" value={link.user_timezone??''} disabled={busy} onChange={e=>void act(async()=>{await crm('rpc/revenue_calendar_settings',{workspace_id:w,args:{p_timezone:e.target.value}});await refresh();})}><option value="">Use each calendar’s time zone</option>{zoneOptions(zoneList,[link.user_timezone]).map(z=><option key={z} value={z}>{z}</option>)}</select></label>
 </section>}
 {status?.connected&&!problem&&<section className="rounded-xl border p-5 space-y-4" aria-label="Upcoming events">
  <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">Next 14 days</h2>{(link?.calendars.length??0)>1&&<select className="rounded border bg-transparent p-2" aria-label="Calendar to show" value={calendar} onChange={e=>setCalendar(e.target.value)}>{link!.calendars.filter(k=>k.available).map(k=><option key={k.calendar_id} value={k.calendar_id}>{k.summary??k.calendar_id}</option>)}</select>}</div>
  {events.length?<ul className="divide-y">{events.map(e=><li key={e.id} className="flex flex-wrap justify-between gap-3 py-3"><span><strong>{e.title}</strong><small className="block">{e.all_day?formatInZone(e.start_date!,'UTC',e.start_date):formatInZone(e.start!,e.time_zone??'UTC')}{e.attendees.filter(a=>!a.self).length?` · ${e.attendees.filter(a=>!a.self).length} guests`:''}{e.recurring?' · repeats':''}</small></span>
   <div className="flex gap-3">{e.can_edit?<><button disabled={busy} onClick={()=>startEdit(e)}>Edit</button><button disabled={busy} onClick={()=>void act(async()=>{setEditing(e.id);setReview(await mail<CalendarReview>('propose','POST',{action:'cancel',calendar_id:calendar,event_id:e.id,notify:e.attendees.some(x=>!x.self)}));})}>Cancel event</button></>:<small>Organized by {e.organizer_email??'someone else'}</small>}{e.html_link&&<a href={e.html_link} target="_blank" rel="noreferrer">Open in Google</a>}</div></li>)}</ul>:<p>No events in the next 14 days.</p>}
 </section>}
 {status?.connected&&!problem&&<section className="rounded-xl border p-5 space-y-4" aria-label="Create or edit an event">
  <h2 className="text-xl font-semibold">{editing?'Edit event':'New event'}</h2>
  <form className="space-y-3" onSubmit={e=>{e.preventDefault();void act(async()=>setReview(await mail<CalendarReview>('propose','POST',editing?{action:'update',calendar_id:calendar,event_id:editing,draft:body(draft),notify:notify&&guests}:{action:'create',calendar_id:writeTo,draft:body(draft),notify:notify&&guests})));}}>
   <label className="block">Title<input required maxLength={300} className="block w-full rounded border bg-transparent p-2" value={draft.title} onChange={e=>{setDraft({...draft,title:e.target.value});setReview(null);}}/></label>
   <EventWhenFields form={draft} zones={zoneList} onChange={f=>{setDraft(f);setReview(null);}}/>
   <label className="block">Guests (email addresses)<input className="block w-full rounded border bg-transparent p-2" value={draft.attendees} onChange={e=>{setDraft({...draft,attendees:e.target.value});setReview(null);}} placeholder="Leave empty for an event only you see"/></label>
   <label className="block">Location<input maxLength={500} className="block w-full rounded border bg-transparent p-2" value={draft.location} onChange={e=>{setDraft({...draft,location:e.target.value});setReview(null);}}/></label>
   <label className="block">Description<textarea maxLength={8000} rows={3} className="block w-full rounded border bg-transparent p-2" value={draft.description} onChange={e=>{setDraft({...draft,description:e.target.value});setReview(null);}}/></label>
   <label className="block"><input type="checkbox" checked={notify&&guests} disabled={!guests} onChange={e=>{setNotify(e.target.checked);setReview(null);}}/> Let Google email guests about this change{!guests&&' (no guests added)'}</label>
   <p className="text-sm opacity-70">{editing?'Saved to the calendar it is in.':`Saved to ${link?.calendars.find(k=>k.calendar_id===writeTo)?.summary??'your primary calendar'}.`}</p>
   <div className="flex gap-3"><button className="rounded border px-4 py-2" disabled={busy}>Review</button>{editing&&<button type="button" onClick={()=>{setEditing(null);setReview(null);setNotify(false);setDraft(blank());}}>Stop editing</button>}</div>
  </form>
 </section>}
 {review&&<CalendarReviewDialog key={review.ticket} review={review} busy={busy} onBack={()=>setReview(null)} onConfirm={confirmed=>void act(async()=>{const ticket=review.ticket;setReview(null);try{const r=await mail<{action:string;notified:string[];crm:{recorded:boolean;reason?:string}}>('commit','POST',{ticket,confirmed:true,notify_confirmed:confirmed});setEditing(null);setNotify(false);setDraft(blank());setNotice(`${{create:'Event created',update:'Event updated',cancel:'Event cancelled'}[r.action]??'Saved'}.${r.notified.length?` Google is emailing ${r.notified.join(', ')}.`:' Nobody was emailed.'}${r.crm.recorded?' Added to Onixus CRM.':''}`);}finally{await loadEvents(calendar).catch(()=>undefined);}})}/>}
 </Surface>;
}
function problemOf(status:CalendarStatus|null,link:CrmConnection|null){
 if(!status?.connected)return null;
 if(!status.crm_linked||link&&!link.linked)return problems.unlinked;
 const s=status.health?.status??'healthy',c=link?.status??'healthy';
 for(const k of [s,c])if(k!=='healthy'&&k!=='pending'&&problems[k]&&k!=='error')return problems[k];
 return null;
}
