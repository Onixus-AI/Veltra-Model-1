import {crmUser} from './crm/server';

type SignalReport={status:string;daily:{date:string;operations:number}[];warnings?:string[];[key:string]:unknown};
type Activity={status:'verified'|'unavailable';operations?:number;records_created?:number;model_requests?:number;known_tokens?:number;unknown_token_receipts?:number;wallet_metered?:boolean;note?:string;published?:number;provider_cost_cents?:number|null;image_provider_cost_usd?:number;image_cost_receipts?:number;provider_cost_receipts?:number|null;signal_credits_used?:number|null;signal_credits_returned?:number|null};
export async function usageActivity(request:Request,period:{month:string;since:string;period_end:string},net:typeof fetch=fetch){
 const activity:Record<string,Activity>={mail:{status:'unavailable'},crm:{status:'unavailable'},signal:{status:'unavailable'}};
 const daily:Record<string,Record<string,number>>={},warnings:string[]=[];
 const add=(date:string,app:string,value:number)=>{daily[date]??={};daily[date][app]=(daily[date][app]??0)+value;};
 const mail=async()=>{try{const origin=process.env.VELTRA_MAIL_URL?.replace(/\/$/,'');if(!origin)throw Error();
  const response=await net(origin+'/chat/usage?'+new URLSearchParams({month:period.month}),{headers:{Authorization:request.headers.get('authorization')??''},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error();const body=await response.json();if(body.month!==period.month||!Array.isArray(body.daily)||!Number.isSafeInteger(body.operations))throw Error();
  activity.mail={status:'verified',operations:body.operations,model_requests:body.model_requests,known_tokens:body.known_tokens,unknown_token_receipts:body.unknown_token_receipts,wallet_metered:body.wallet_metered===true,note:body.note};
  for(const row of body.daily)if(typeof row.date==='string'&&row.date.startsWith(period.month+'-'))add(row.date,'mail',Number(row.operations??0));
  for(const warning of body.warnings??[])if(typeof warning==='string')warnings.push(warning);
 }catch{warnings.push('Mail activity could not be verified.');}};
 const business=async()=>{try{
  const {client,user}=await crmUser(request);
  const owned=await client.from('crm_workspaces').select('id').eq('owner_id',user.id).limit(101);
  if(owned.error||!owned.data||owned.data.length>100)throw Error();const ids=owned.data.map(w=>w.id);
  if(!ids.length){activity.crm={status:'verified',operations:0,records_created:0};return;}
  const crm=async()=>{try{
   const count=await client.from('crm_customers').select('id',{count:'exact',head:true}).in('workspace_id',ids).gte('created_at',period.since).lt('created_at',period.period_end);if(count.error||count.count==null)throw Error();
   const dates:string[]=[];for(let at=Date.parse(period.since);at<Date.parse(period.period_end);at+=86400000)dates.push(new Date(at).toISOString().slice(0,10));
   const counts:{date:string;count:number}[]=[];
   for(let offset=0;offset<dates.length;offset+=5)counts.push(...await Promise.all(dates.slice(offset,offset+5).map(async date=>{
    const next=new Date(Date.parse(date+'T00:00:00Z')+86400000).toISOString();const r=await client.from('crm_activity').select('id',{count:'exact',head:true}).in('workspace_id',ids).gte('created_at',date+'T00:00:00Z').lt('created_at',next);if(r.error||r.count==null)throw Error();return {date,count:r.count};
   })));
   for(const row of counts)add(row.date,'crm',row.count);
   activity.crm={status:'verified',operations:counts.reduce((n,r)=>n+r.count,0),records_created:count.count,note:'Activity across your owned business workspaces, independent of Mail. Activity counts are not AI credits.'};
  }catch{warnings.push('CRM activity could not be verified.');}};
  const signal=async()=>{try{
   const links=await client.from('crm_signal_connections').select('workspace_id,signal_client_id').in('workspace_id',ids);if(links.error||!links.data)throw Error();
   // Multiple workspaces linked to the same Signal login must not double-count its receipts.
   const unique=[...new Map(links.data.map(l=>[l.signal_client_id,l])).values()];if(!unique.length)return;
   const key=process.env.SIGNAL_SUPABASE_PUBLISHABLE_KEY,workspaceKey=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;if(!key||!workspaceKey)throw Error();
   const reports:SignalReport[]=[];for(const link of unique){const r=await net('https://rjwbfkuzgusaoizcmmgf.supabase.co/functions/v1/workspace-signal-creative',{method:'POST',headers:{Authorization:request.headers.get('authorization')??'',apikey:key,'x-workspace-public-key':workspaceKey,'Content-Type':'application/json'},body:JSON.stringify({workspace:link.workspace_id,action:'usage',month:period.month}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error();const b=await r.json();if(!b.ok||b.scope?.workspace_id!==link.workspace_id||b.receipt?.month!==period.month||!Array.isArray(b.receipt.daily))throw Error();reports.push(b.receipt);}
   const sum=(key:string)=>reports.every(r=>typeof r[key]==='number'&&Number.isFinite(r[key])&&(r[key] as number)>=0)?reports.reduce((n,r)=>n+(r[key] as number),0):null;
   for(const r of reports){for(const row of r.daily)if(typeof row.date==='string'&&row.date.startsWith(period.month+'-')&&Number.isSafeInteger(row.operations)&&row.operations>=0)add(row.date,'signal',row.operations);for(const warning of r.warnings??[])warnings.push('Signal: '+warning);}
   activity.signal={status:reports.every(r=>r.status==='verified')?'verified':'unavailable',operations:sum('operations')??undefined,model_requests:sum('model_requests')??undefined,published:sum('published')??undefined,provider_cost_cents:sum('provider_cost_cents'),provider_cost_receipts:sum('provider_cost_receipts'),image_provider_cost_usd:sum('image_provider_cost_usd')??undefined,image_cost_receipts:sum('image_cost_receipts')??undefined,signal_credits_used:sum('signal_credits_used'),signal_credits_returned:sum('signal_credits_returned'),note:'Signal content items, recorded agency costs and Signal video credits. Separate from Workspace wallet charges; provider costs are partial receipt coverage.'};
  }catch{warnings.push('Signal usage could not be verified.');}};
  await Promise.all([crm(),signal()]);
 }catch{warnings.push('Owned business workspaces could not be verified.');}};
 await Promise.all([mail(),business()]);
 return {activity,activity_daily:daily,activity_warnings:warnings};
}
