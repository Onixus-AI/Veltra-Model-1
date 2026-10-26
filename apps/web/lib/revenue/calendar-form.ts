import {localToUtc,validTimeZone} from './workspace-calendar';

const UTC_ALIASES=new Set(['UTC','Etc/UTC','Etc/UCT','UCT','Etc/GMT','GMT','Etc/GMT0','GMT0','Etc/GMT+0','Etc/GMT-0','GMT+0','GMT-0','Etc/Greenwich','Greenwich','Etc/Universal','Universal','Etc/Zulu','Zulu']);

/** A valid IANA zone, with every spelling of UTC shown as plain "UTC". */
export function normalizeZone(tz:string|null|undefined):string|null{
 if(!tz)return null;
 if(UTC_ALIASES.has(tz))return 'UTC';
 return validTimeZone(tz);
}

/** New events default to the person's own zone, then the target calendar's, then the browser's. */
export function defaultEventZone(o:{user?:string|null;calendar?:string|null;browser?:string|null}){
 return normalizeZone(o.user)??normalizeZone(o.calendar)??normalizeZone(o.browser)??'UTC';
}

/** Zone choices for a select: UTC first, no UTC aliases, and every value in use is present. */
export function zoneOptions(supported:string[],inUse:(string|null|undefined)[]=[]){
 const out=['UTC'],seen=new Set(out);
 for(const z of [...supported,...inUse]){const n=normalizeZone(z);if(n&&!seen.has(n)){seen.add(n);out.push(n);}}
 return out;
}

export function validDate(s:string){
 const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
 if(!m||+m[1]<1900||+m[1]>2200)return false;
 return new Date(Date.UTC(+m[1],+m[2]-1,+m[3])).toISOString().slice(0,10)===s;
}
export function validTime(s:string){const m=/^(\d{2}):(\d{2})$/.exec(s);return !!m&&+m[1]<24&&+m[2]<60;}

/** Wall-clock arithmetic; the zone only matters when the time is turned into an instant. */
export function addMinutes(date:string,time:string,minutes:number){
 const [y,mo,d]=date.split('-').map(Number),[h,mi]=time.split(':').map(Number);
 const t=new Date(Date.UTC(y,mo-1,d,h,mi)+minutes*60_000).toISOString();
 return {date:t.slice(0,10),time:t.slice(11,16)};
}
export function splitLocal(local:string){return {date:local.slice(0,10),time:local.slice(11,16)};}

export type EventForm={title:string;description:string;location:string;all_day:boolean;start_date:string;start_time:string;end_date:string;end_time:string;time_zone:string;zone_chosen:boolean;end_chosen:boolean;attendees:string};
export const DEFAULT_MINUTES=30;
export const emptyForm=(tz:string):EventForm=>({title:'',description:'',location:'',all_day:false,start_date:'',start_time:'',end_date:'',end_time:'',time_zone:tz,zone_chosen:false,end_chosen:false,attendees:''});
type Field='start_date'|'start_time'|'end_date'|'end_time';

/**
 * One date or time field changed. Browsers report "" while a field is half typed; that is stored
 * as-is so nothing is reformatted under the cursor. Until the person picks an end, the end follows
 * the start, keeping the current length (30 minutes for a new event).
 */
export function setWhen(f:EventForm,field:Field,value:string):EventForm{
 const next={...f,[field]:value};
 if(field==='end_date'||field==='end_time')return {...next,end_chosen:true};
 if(f.end_chosen||!validDate(next.start_date))return next;
 if(f.all_day||!validTime(next.start_time)){
  if(!validDate(f.end_date)||f.end_date<next.start_date)next.end_date=next.start_date;
  return next;
 }
 let length=DEFAULT_MINUTES;
 if(validDate(f.start_date)&&validTime(f.start_time)&&validDate(f.end_date)&&validTime(f.end_time)){
  const was=Date.parse(`${f.end_date}T${f.end_time}Z`)-Date.parse(`${f.start_date}T${f.start_time}Z`);
  if(was>0)length=was/60_000;
 }
 const end=addMinutes(next.start_date,next.start_time,length);
 return {...next,end_date:end.date,end_time:end.time};
}

/** What the person typed, checked and in the shape Mail expects, or the first problem to show. */
export function formWhen(f:EventForm):{start:string;end:string;error?:undefined}|{error:string}{
 if(f.all_day){
  if(!validDate(f.start_date))return {error:'Enter a valid start date.'};
  if(!validDate(f.end_date))return {error:'Enter a valid end date.'};
  if(f.end_date<f.start_date)return {error:'The end date must be on or after the start date.'};
  return {start:f.start_date,end:f.end_date};
 }
 if(!validDate(f.start_date)||!validTime(f.start_time))return {error:'Enter a valid start date and time.'};
 if(!validDate(f.end_date)||!validTime(f.end_time))return {error:'Enter a valid end date and time.'};
 const start=`${f.start_date}T${f.start_time}`,end=`${f.end_date}T${f.end_time}`;
 try{
  const a=localToUtc(start,f.time_zone),b=localToUtc(end,f.time_zone);
  if(Date.parse(b.utc)<=Date.parse(a.utc))return {error:'The event must end after it starts.'};
 }catch(e){return {error:e instanceof Error?e.message:'Enter a valid date and time.'};}
 return {start,end};
}
