import {crmUser} from './crm/server';

type Activity={status:'verified'|'unavailable';operations?:number;records_created?:number;model_requests?:number;known_tokens?:number;unknown_token_receipts?:number;wallet_metered?:boolean;note?:string};
export async function usageActivity(request:Request,period:{month:string;since:string;period_end:string},net:typeof fetch=fetch){
 const activity:Record<string,Activity>={mail:{status:'unavailable',note:'Mail usage source is unavailable.'},crm:{status:'unavailable',note:'A verified linked CRM workspace is required.'}};
 const daily:Record<string,Record<string,number>>={};const warnings:string[]=[];
 const origin=process.env.VELTRA_MAIL_URL?.replace(/\/$/,'');if(!origin)return {activity,activity_daily:daily,activity_warnings:['Mail activity reporting is not configured.']};
 try{
  const response=await net(origin+'/chat/usage?'+new URLSearchParams({month:period.month}),{headers:{Authorization:request.headers.get('authorization')??''},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('Mail activity unavailable');
  const mail=await response.json();if(mail.month!==period.month||!Array.isArray(mail.daily)||!Number.isSafeInteger(mail.operations))throw Error('Invalid Mail period');
  activity.mail={status:'verified',operations:mail.operations,model_requests:mail.model_requests,known_tokens:mail.known_tokens,unknown_token_receipts:mail.unknown_token_receipts,wallet_metered:false,note:mail.note};
  for(const row of mail.daily)if(typeof row.date==='string'&&row.date.startsWith(period.month+'-'))daily[row.date]={mail:Number(row.operations??0)};
  for(const warning of mail.warnings??[])if(typeof warning==='string')warnings.push(warning);
  if(typeof mail.workspace_id==='string'){
   const {client,user}=await crmUser(request);
   const owned=await client.from('crm_workspaces').select('id').eq('id',mail.workspace_id).eq('owner_id',user.id).maybeSingle();
   if(owned.error||!owned.data)throw Error('Linked workspace is not owned by this account');
   const scope=(table:string,fields:string,head=false)=>client.from(table).select(fields,{count:'exact',head}).eq('workspace_id',mail.workspace_id).gte('created_at',period.since).lt('created_at',period.period_end);
   const count=await scope('crm_customers','id',true);if(count.error)throw count.error;
   let events=0,total:number|null=null;
   for(let offset=0;offset<10000;offset+=500){const result=await scope('crm_activity','id,created_at').order('created_at').order('id').range(offset,offset+499);if(result.error)throw result.error;total=result.count;const rows=(result.data??[]) as unknown as {id:string;created_at:string}[];events+=rows.length;for(const row of rows){const date=new Date(row.created_at).toISOString().slice(0,10);daily[date]??={};daily[date].crm=(daily[date].crm??0)+1;}if(rows.length<500)break;}
   if(total!=null&&events<total)warnings.push('CRM daily activity is capped at 10,000 events; the total remains exact.');
   activity.crm={status:'verified',operations:total??events,records_created:count.count??0,note:'CRM activity events and records created in the linked, owned workspace. These operations are distinct from wallet-billed model requests.'};
  }
 }catch{if(activity.crm.status!=='verified')for(const row of Object.values(daily))delete row.crm;warnings.push('Some app activity could not be verified. Unavailable activity is not reported as zero.');}
 return {activity,activity_daily:daily,activity_warnings:warnings};
}
