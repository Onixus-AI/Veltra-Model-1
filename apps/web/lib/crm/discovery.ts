import type {SupabaseClient} from '@supabase/supabase-js';
export function researchResults(raw:unknown){
 const d=raw as {success?:boolean;data?:{web?:{url?:string;title?:string;description?:string}[]}};
 if(!d.success||!Array.isArray(d.data?.web))throw new Error('Research provider returned an invalid result.');
 const seen=new Set<string>();return d.data.web.slice(0,50).flatMap(r=>{try{const url=new URL(String(r.url));if(url.protocol!=='https:'||url.username||url.password||seen.has(url.href))return [];seen.add(url.href);return [{url:url.href,title:String(r.title??url.hostname).slice(0,300),description:String(r.description??'').slice(0,1500)}];}catch{return [];}});
}
export async function runDiscovery(client:SupabaseClient,user:string,id:string,limit:number,key:string,fetcher:typeof fetch=fetch){
 if(!key)throw new Error('503:Research needs its provider credential before execution.');
 if(!Number.isInteger(limit)||limit<1||limit>50)throw new Error('400:Choose 1–50 results.');
 const {data:request,error}=await client.from('crm_discovery_requests').select('*').eq('id',id).single();if(error||!request)throw new Error('404:Research request not found.');
 const {data:workspace}=await client.from('crm_workspaces').select('owner_id').eq('id',request.workspace_id).single();if(workspace?.owner_id!==user)throw new Error('403:Only the business owner can run paid research.');
 if(request.status!=='requested')throw new Error('409:This request already ran or needs review. Create a new request to research again.');
 const {data:claim,error:claimError}=await client.rpc('crm_claim_discovery',{p_request:id});if(claimError||!claim)throw new Error('409:Research is already running or the daily research limit was reached.');
 try{
  const response=await fetcher('https://api.firecrawl.dev/v2/search',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({query:`${request.query} ${request.location} business contact`,limit,sources:['web']}),redirect:'error',signal:AbortSignal.timeout(25000)});
  if(!response.ok)throw new Error('Research provider unavailable. Check its balance and credentials.');
  const results=researchResults(await response.json());
  const {error:write}=await client.rpc('crm_finish_discovery',{p_request:id,p_success:true,p_results:results,p_error:null});if(write)throw write;return {results,status:'review'};
 }catch{await client.rpc('crm_finish_discovery',{p_request:id,p_success:false,p_results:[],p_error:'Research failed or its result is uncertain. Check provider usage before creating another request.'});throw new Error('503:Research failed; check provider usage before retrying.');}
}
