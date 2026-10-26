import {NextRequest} from 'next/server';
export const runtime='nodejs';
export const maxDuration=60;
async function proxy(request:NextRequest,context:{params:Promise<{path:string[]}>}){
 const {path}=await context.params;
 const route=path.join('/');
 if(!['status','start','files','file','propose','create','editor','save','disconnect'].includes(route))return new Response('Not found',{status:404});
 const methods:Record<string,string>={status:'GET',start:'POST',files:'GET',file:'GET',propose:'POST',create:'POST',editor:'GET',save:'POST',disconnect:'DELETE'};
 if(request.method!==methods[route])return new Response('Method not allowed',{status:405});
 const authorization=request.headers.get('authorization');
 if(!authorization?.startsWith('Bearer '))return Response.json({error:'Sign in to Onixus Workspace first.'},{status:401});
 const base=process.env.VELTRA_MAIL_URL;if(!base)return Response.json({error:'Google Workspace backend is not configured.'},{status:503});
 if(request.headers.has('x-veltra-task'))return Response.json({error:'Google files are available in the files panel. Chat task access is not enabled yet.'},{status:403});
 try{
  const suffix=route==='status'||route==='disconnect'?'':route;
  const response=await fetch(`${base.replace(/\/$/,'')}/chat/google/${suffix}${request.nextUrl.search}`,{method:request.method,headers:{authorization,'Content-Type':'application/json'},body:request.method==='POST'?await request.text():undefined,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(50_000)});
  if(!response.headers.get('content-type')?.includes('application/json'))return Response.json({error:'Google Workspace backend needs to be deployed before connecting.'},{status:502});
  return new Response(response.body,{status:response.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
 }catch{return Response.json({error:'Google Workspace is temporarily unavailable.'},{status:502});}
}
export const GET=proxy;export const POST=proxy;export const DELETE=proxy;
