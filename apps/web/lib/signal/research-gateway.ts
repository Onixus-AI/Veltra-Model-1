import {webSearch} from '../web-search';
const SIGNAL='https://rjwbfkuzgusaoizcmmgf.supabase.co';
export function researchUrl(value:unknown){
 const u=new URL(String(value));
 if(u.protocol!=='https:'||u.username||u.password||u.port||!u.hostname.includes('.')||!/[a-z]/i.test(u.hostname)||/(^|\.)(localhost|local|internal|test|invalid)$/.test(u.hostname)||u.hostname.includes(':'))throw Error('Public HTTPS source required');
 return u.href;
}
/** Fixed-origin service-role verification; no new shared secret and no browser credentials. */
export async function researchGateway(req:Request,key:string|undefined,net:typeof fetch=fetch){
 const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
 const token=req.headers.get('Authorization')?.match(/^Bearer ([^\s]+)$/)?.[1];
 if(!token)return reply({error:'Signal service authorization required'},401);
 const auth=await net(SIGNAL+'/auth/v1/admin/users?page=1&per_page=1',{headers:{Authorization:'Bearer '+token,apikey:token},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});
 await auth.body?.cancel();if(!auth.ok)return reply({error:'Signal service authorization rejected'},403);
 if(!key)return reply({error:'Research provider not configured'},503);
 try{
  const raw=await req.text();if(raw.length>5000)return reply({error:'Research request too large'},413);
  const body=JSON.parse(raw);
  if(body.action==='search'){
   if(!Array.isArray(body.queries)||body.queries.length<1||body.queries.length>3)return reply({error:'Provide one to three public queries'},400);
   const results=[];for(const q of body.queries)results.push(await webSearch(q,key,net));
   return reply({results,provider:'firecrawl',scope:'Discovery only; snippets are not verified full-page evidence.'});
  }
  if(body.action==='retrieve'){
   if(!Array.isArray(body.urls)||body.urls.length<1||body.urls.length>4)return reply({error:'Provide one to four sources'},400);
   const urls=[...new Set(body.urls.map(researchUrl))];
   const results=await Promise.all(urls.map(async url=>{
    const r=await net('https://api.firecrawl.dev/v2/scrape',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({url,formats:['markdown'],onlyMainContent:true}),redirect:'error',signal:AbortSignal.timeout(45000)});
    if(!r.ok)return {url,status:'unavailable',http_status:r.status};
    const data=await r.json();const text=data?.success&&typeof data.data?.markdown==='string'?data.data.markdown.trim():'';
    if(text.length<150)return {url,status:'unavailable',reason:'No readable source text'};
    const finalUrl=researchUrl(data.data.metadata?.sourceURL??url);
    return {url:finalUrl,status:'retrieved',excerpt:text.slice(0,4500),retrieved_at:new Date().toISOString(),kind:'public_page',performance:'unknown'};
   }));return reply({sources:results,provider:'firecrawl'});
  }
  return reply({error:'Unknown research tool'},400);
 }catch{return reply({error:'Research tool failed; no findings verified'},503);}
}
