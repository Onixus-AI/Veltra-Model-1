import {NextRequest} from 'next/server';
export const runtime='nodejs';
export const maxDuration=120;
async function beeProxy(request:NextRequest,context:{params:Promise<{path:string[]}>}){
 const {path}=await context.params;
 const valid=path.length===1&&((path[0]==='status'&&['GET','DELETE'].includes(request.method))||(path[0]==='start'&&request.method==='POST')||(path[0]==='call'&&request.method==='POST'));
 if(!valid)return Response.json({error:'Not found.'},{status:404});
 const authorization=request.headers.get('authorization');if(!authorization?.startsWith('Bearer '))return Response.json({error:'Sign in to Onixus Workspace first.'},{status:401});
 const base=process.env.VELTRA_MAIL_URL;if(!base)return Response.json({error:'Bee connections are not configured.'},{status:503});
 try{
  const r=await fetch(base.replace(/\/$/,'')+'/chat/bee'+(path[0]==='status'?'':'/'+path[0]),{method:request.method,headers:{Authorization:authorization,'Content-Type':'application/json'},body:request.method==='POST'?await request.text():undefined,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(100000)});
  if(!r.headers.get('content-type')?.includes('application/json'))throw Error();
  return new Response(r.body,{status:r.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
 }catch{return Response.json({error:'Bee is temporarily unavailable.'},{status:502});}
}
export const GET=beeProxy,POST=beeProxy,DELETE=beeProxy;
