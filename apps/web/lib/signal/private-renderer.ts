import {createHash,timingSafeEqual} from 'node:crypto';
import {cloudRunHeaders} from '../business-team/cloud-run-auth';

const METHODS:Record<string,string>={health:'GET',templates:'GET',render:'POST','render-video':'POST','screenshot-url':'POST','research-ads':'POST','adapt-ad':'POST'};
const MAX_BODY=1_048_576;
type Options={env?:Record<string,string|undefined>;transport?:typeof fetch;identity?:typeof cloudRunHeaders};
const same=(a:string,b:string)=>timingSafeEqual(createHash('sha256').update(a).digest(),createHash('sha256').update(b).digest());
const failure=(status:number,error:string)=>Response.json({error},{status,headers:{'Cache-Control':'no-store'}});

/** Server-to-server only. No arbitrary destination, task endpoint or browser session is forwarded. */
export async function privateRenderer(request:Request,operation:string,options:Options={}){
 const env=options.env??process.env;
 if(!METHODS[operation]||request.method!==METHODS[operation]||new URL(request.url).search)return failure(404,'Unknown renderer operation');
 const secret=env.SIGNAL_RENDER_TOKEN;
 if(env.VERCEL_ENV!=='production'||!secret||secret.length<32||!env.SIGNAL_RENDER_PRIVATE_URL)return failure(503,'Private renderer connection is not configured');
 const supplied=request.headers.get('authorization')??'';
 if(!same(supplied,'Bearer '+secret))return failure(401,'Unauthorized');
 let endpoint:URL;
 try{endpoint=new URL(env.SIGNAL_RENDER_PRIVATE_URL);if(endpoint.protocol!=='https:'||!endpoint.hostname.endsWith('.run.app')||endpoint.port||endpoint.pathname!=='/'||endpoint.search||endpoint.hash||endpoint.username||endpoint.password)throw Error();}
 catch{return failure(503,'Invalid private renderer configuration');}
 let body:string|undefined;
 if(request.method==='POST'){
  if(!request.headers.get('content-type')?.startsWith('application/json'))return failure(415,'JSON required');
  if(Number(request.headers.get('content-length')??0)>MAX_BODY)return failure(413,'Renderer request too large');
  const reader=request.body?.getReader();const chunks:Uint8Array[]=[];let size=0;
  if(reader){for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>MAX_BODY){await reader.cancel();return failure(413,'Renderer request too large');}chunks.push(part.value);}}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  body=new TextDecoder().decode(bytes);
  try{JSON.parse(body);}catch{return failure(400,'Invalid JSON');}
 }
 try{
  const identity=await (options.identity??cloudRunHeaders)(endpoint,{env});
  if(!identity['X-Serverless-Authorization'])return failure(503,'Private renderer identity unavailable');
  const response=await (options.transport??fetch)(new URL('/'+operation,endpoint),{method:request.method,headers:{...identity,Authorization:'Bearer '+secret,...(body?{'Content-Type':'application/json'}:{})},body,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(120_000)});
  return new Response(response.body,{status:response.status,headers:{'Content-Type':response.headers.get('content-type')??'application/json','Cache-Control':'no-store'}});
 }catch{return failure(502,'Private renderer request failed');}
}
