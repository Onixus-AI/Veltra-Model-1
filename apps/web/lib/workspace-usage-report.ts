import type {SupabaseClient} from '@supabase/supabase-js';

const APP_LABELS={chat:'Chat',crm:'CRM',mail:'Mail',signal:'Signal',business_os:'Business OS',code:'Code',images:'Images',voice:'Voice',unassigned:'Unassigned history'} as const;
type AppId=keyof typeof APP_LABELS;
type Row=Record<string,unknown>;
type Event={id:string;app:AppId;task:string;status:string;credits:number;tokens:number|null;model:string|null;at:string;attribution?:string};

function dateRange(month:string,day:string|null,now:Date){
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('422:Month must use YYYY-MM.');
 const [year,number]=month.split('-').map(Number);
 if(year<2000||year>9998)throw Error('422:Invalid month.');
 const start=new Date(Date.UTC(year,number-1,1)),end=new Date(Date.UTC(year,number,1));
 if(day){const parsed=Date.parse(day+'T00:00:00Z');if(day.slice(0,7)!==month||!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(parsed)||new Date(parsed).toISOString().slice(0,10)!==day)throw Error('422:Day must belong to the selected month.');}
 return {start,end,until:now.toISOString()};
}
const positive=(value:unknown)=>Math.max(0,Number(value)||0);
const str=(value:unknown)=>typeof value==='string'?value:'';

/** Preserve the old gateway's receipt semantics while reading the same organization-scoped tables. */
export async function workspaceUsageReport(db:SupabaseClient,organizationId:string,month:string,day:string|null,now=new Date()){
 const {start,end,until}=dateRange(month,day,now),warnings:string[]=[];
 const since=start.toISOString(),periodEnd=end.toISOString();
 async function read(table:string,columns:string):Promise<Row[]>{
  const rows:Row[]=[];
  try{
   for(let offset=0;offset<10000;offset+=500){
    const page=await db.from(table).select(columns).eq('organization_id',organizationId).gte('created_at',since).lt('created_at',periodEnd).order('created_at',{ascending:false}).range(offset,offset+499);
    if(page.error||!Array.isArray(page.data))throw Error();
    rows.push(...page.data as unknown as Row[]);
    if(page.data.length<500)return rows;
   }
   warnings.push(`${table}: limited to latest 10,000 receipts`);
  }catch{warnings.push(`${table}: receipts unavailable; totals may be incomplete`);}
  return rows;
 }
 const [logs,runs,ledger,mailRequests]=await Promise.all([
  read('usage_logs','id,category,model_used,tokens_consumed,credits_deducted,created_at'),
  read('agent_runs','id,status,stage,credits_reserved,credits_used,created_at'),
  read('credit_transactions','id,amount,description,created_at'),
  read('mail_credit_requests','id,status,credits_reserved,created_at'),
 ]);
 let reserved=0;
 const mailReserved=mailRequests.filter(row=>row.status==='reserved').reduce((n,row)=>n+positive(row.credits_reserved),0);
 reserved+=mailReserved;
 const oldMailHolds=mailRequests.filter(row=>row.status==='reserved'&&Date.parse(str(row.created_at))<now.getTime()-300_000);
 if(oldMailHolds.length)warnings.push(`${oldMailHolds.length} Mail credit hold(s) need reconciliation; they are not completed charges.`);
 const events:Event[]=[];
 for(const row of logs){
  const category=str(row.category),model=str(row.model_used),legacyChat=category==='chat'&&!model.startsWith('elevenlabs-');
  const raw=category.startsWith('workspace.')?category.slice(10):model.startsWith('elevenlabs-')?'voice':category==='image'?'images':category;
  const app=(raw in APP_LABELS?raw:'unassigned') as AppId;
  const task=legacyChat?'Chat completion (legacy shared endpoint)':app==='images'?'Image generation':app==='voice'?'Voice processing':app==='unassigned'?'Model request (source not recorded)':APP_LABELS[app]+' model request';
  events.push({id:str(row.id),app,task,status:'charged',credits:positive(row.credits_deducted),tokens:positive(row.tokens_consumed),model:model||null,at:str(row.created_at),...(legacyChat?{attribution:'legacy_shared_endpoint'}:{})});
 }
 for(const row of runs){
  const used=positive(row.credits_used),status=str(row.status)||'unknown';
  if(['queued','running','interrupted'].includes(status))reserved+=Math.max(0,positive(row.credits_reserved)-used);
  events.push({id:str(row.id),app:'code',task:'Coding task '+str(row.id).slice(0,8),status,credits:used,tokens:null,model:null,at:str(row.created_at)});
 }
 events.sort((a,b)=>b.at.localeCompare(a.at)||b.id.localeCompare(a.id));
 const apps=Object.entries(APP_LABELS).map(([id,label])=>{
  const matching=events.filter(event=>event.app===id);
  return {id,label,credits:matching.reduce((n,e)=>n+e.credits,0),tokens:matching.reduce((n,e)=>n+(e.tokens??0),0),tasks:matching.length,legacy_credits:matching.filter(e=>e.attribution==='legacy_shared_endpoint').reduce((n,e)=>n+e.credits,0),coverage:matching.length?'recorded':'no_attributed_records'};
 });
 const consumption=[];
 for(let time=start.getTime();time<end.getTime();time+=86_400_000){
  const date=new Date(time).toISOString().slice(0,10),dayEvents=events.filter(e=>e.at.slice(0,10)===date);
  consumption.push({date,credits:dayEvents.reduce((n,e)=>n+e.credits,0),apps:Object.fromEntries(apps.map(a=>[a.id,dayEvents.filter(e=>e.app===a.id).reduce((n,e)=>n+e.credits,0)])),operations:Object.fromEntries(apps.map(a=>[a.id,dayEvents.filter(e=>e.app===a.id).length]))});
 }
 const visible=day?events.filter(e=>e.at.slice(0,10)===day):events;
 return {month,selected_day:day,period_end:periodEnd,filtered_event_count:visible.length,since,until,time_zone:'UTC',apps,events:visible.slice(0,250),event_count:events.length,event_limit:250,consumption,used:events.reduce((n,e)=>n+e.credits,0),reserved_remaining:reserved,mail_reserved_remaining:mailReserved,ledger:ledger.slice(0,100),warnings,
  note:'Chat includes historical charges recorded by the shared chat-completion endpoint; embedded assistants cannot be separated retroactively. Missing categories stay unassigned. Reservations are separate from spend. Signal and Mail may meter through separate services.'};
}
