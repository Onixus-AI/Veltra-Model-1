import { createClient } from '@supabase/supabase-js';
import { empty, type Snapshot } from './domain';
const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
const key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const db=url&&key?createClient(url,key):null;
export async function snapshot(workspace:string):Promise<Snapshot>{
 if(!db) throw new Error('Connect a Veltra Supabase project first.');
 const tables={customers:'crm_customers',deals:'crm_deals',tasks:'crm_tasks',memories:'crm_memories',activities:'crm_activity'};
 const result={...empty};
 await Promise.all(Object.entries(tables).map(async([k,t])=>{
  const rows:unknown[]=[];
  for(let offset=0;;offset+=500){
   const {data,error}=await db!.from(t).select('*').eq('workspace_id',workspace).order('created_at',{ascending:false}).order('id').range(offset,offset+499);
   if(error)throw new Error(error.message);rows.push(...data);
   if(data.length<500||k==='activities')break;
  }
  Object.assign(result,{[k]:rows});
 }));
 return result;
}
