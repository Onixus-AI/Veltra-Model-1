// CRM business discovery worker. Called once a minute by crm_private.dispatch_discovery() with a
// single-use job token; reads one page from the source and saves it through crm_finish_discovery_job.
// Production previously ran a copy uploaded outside this repository; this is now the source of truth.
import {createClient} from 'npm:@supabase/supabase-js@2.118.0';
import {discoverPage} from '../../../apps/web/lib/crm/discovery-source.ts';
Deno.serve(async req=>{
 if(req.method!=='POST')return Response.json({error:'method_not_allowed'},{status:405});
 const raw=await req.text();if(raw.length>1024)return new Response(null,{status:413});
 let b;try{b=JSON.parse(raw);}catch{return new Response(null,{status:400});}
 if(typeof b.job_id!=='string'||typeof b.token!=='string'||b.token.length!==72)return new Response(null,{status:401});
 const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{auth:{persistSession:false}});
 const {data:job,error}=await db.rpc('crm_start_discovery_job',{p_job:b.job_id,p_token:b.token});
 if(error||!job)return new Response(null,{status:401});
 try{
  const page=await discoverPage(job,fetch,{placesKey:Deno.env.get('GOOGLE_PLACES_API_KEY')??''});
  const {data,error:write}=await db.rpc('crm_finish_discovery_job',{p_job:b.job_id,p_token:b.token,p_page:page});
  // Keep the database's reason (for example a statement timeout) instead of a generic message.
  if(write)throw Error('Discovery result could not be saved: '+String(write.message??'unknown error').slice(0,200));
  return Response.json({ok:true,...data});
 }catch(e){
  await db.rpc('crm_finish_discovery_job',{p_job:b.job_id,p_token:b.token,p_page:null,p_error:e instanceof Error?e.message:'Source unavailable'});
  return Response.json({ok:false,retry_scheduled:true},{status:503});
 }
});
