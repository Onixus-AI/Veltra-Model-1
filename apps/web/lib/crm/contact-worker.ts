import {createClient} from '@supabase/supabase-js';
import {researchCompanyWebsite} from './contact-research';
export async function contactWorker(request:Request){
 const raw=await request.text();if(raw.length>1024)return Response.json({error:'Invalid job'},{status:400});
 let body:any;try{body=JSON.parse(raw);}catch{return Response.json({error:'Invalid job'},{status:400});}
 if(typeof body.job_id!=='string'||!/^[a-f0-9-]{36}$/i.test(body.job_id)||typeof body.token!=='string'||body.token.length!==72)return Response.json({error:'Invalid job'},{status:400});
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
 if(!url||!key)return Response.json({error:'Research is not configured'},{status:503});
 const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:job,error}=await client.rpc('crm_start_contact_job',{p_job:body.job_id,p_token:body.token});
 if(error||!job)return Response.json({error:'Job unavailable'},{status:403});
 try{
  const result=await researchCompanyWebsite(job.website);
  const saved=await client.rpc('crm_finish_contact_job',{p_job:body.job_id,p_token:body.token,p_result:result,p_error:null});
  if(saved.error)return Response.json({error:'Research receipt could not be saved'},{status:503});
  return Response.json(saved.data,{headers:{'Cache-Control':'no-store'}});
 }catch(e){
  const saved=await client.rpc('crm_finish_contact_job',{p_job:body.job_id,p_token:body.token,p_result:null,p_error:e instanceof Error?e.message:'Website research unavailable'});
  return Response.json({error:saved.error?'Research receipt could not be saved':'Website research needs attention'},{status:503});
 }
}
