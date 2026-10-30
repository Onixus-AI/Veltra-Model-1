import type {SupabaseClient} from '@supabase/supabase-js';
import {crmDeadline} from './request';
import {empty,type Snapshot} from './domain';
/** Keep complete dashboard totals; fetch remaining pages with bounded concurrency. */
export async function readSnapshot(client:SupabaseClient,workspace:string,signal?:AbortSignal):Promise<Snapshot>{
 const result={...empty};
 const tables={customers:'crm_customers',deals:'crm_deals',tasks:'crm_tasks',memories:'crm_memories',activities:'crm_activity'};
 await Promise.all(Object.entries(tables).map(async([key,table])=>{
  const read=async(offset:number,count=false)=>{
   const timeout=AbortSignal.timeout(20000),requestSignal=signal?AbortSignal.any([signal,timeout]):timeout;
   let query=client.from(table).select('*',count?{count:'exact'}:{}).eq('workspace_id',workspace);if(key==='customers')query=query.is('archived_at',null);
   const response=await crmDeadline(query.order('created_at',{ascending:false}).order('id').range(offset,offset+499).abortSignal(requestSignal),requestSignal);
   if(response.error)throw Error('CRM records could not finish loading. Refresh to try again.');
   return response;
  };
  const first=await read(0,key!=='activities'),pages:unknown[][]=[first.data??[]];
  if(key!=='activities'){
   if(typeof first.count==='number'){
    let next=500;const workers=Array.from({length:Math.min(3,Math.max(0,Math.ceil(first.count/500)-1))},async()=>{
     while(next<first.count!){const offset=next;next+=500;pages[offset/500]=(await read(offset)).data??[];}
    });await Promise.all(workers);
   }else if(first.data?.length===500){
    // Some deployments omit counts. Preserve complete sequential loading there.
    for(let offset=500;;offset+=500){const page=(await read(offset)).data??[];pages.push(page);if(page.length<500)break;}
   }
  }
  Object.assign(result,{[key]:pages.flat()});
 }));return result;
}
