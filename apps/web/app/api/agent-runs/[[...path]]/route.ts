import {NextRequest} from 'next/server';
import {gatewayUrl, gatewayAuthorization} from '@/lib/gateway';
export const runtime='nodejs';
export const maxDuration=30;
async function proxy(request:NextRequest,{params}:{params:Promise<{path?:string[]}>}){
 const {path=[]}=await params;
 const uuid=/^[a-f0-9-]{36}$/i;
 if(!(path.length===0||path.length===1&&uuid.test(path[0])||path.length===2&&uuid.test(path[0])&&path[1]==='cancel'))return Response.json({detail:'Route not found.'},{status:404});
 const authorization=gatewayAuthorization(request);
 if(!authorization)return Response.json({detail:'Sign in to Veltra.'},{status:401});
 const body=request.method==='POST'?await request.text():undefined;
 if(body&&body.length>2_100_000)return Response.json({detail:'Task is too large.'},{status:413});
 try{
  const response=await fetch(`${gatewayUrl()}/v1/agent-runs${path.length?'/'+path.join('/'):''}`,{method:request.method,headers:{Authorization:authorization,'Content-Type':'application/json'},body,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(25000)});
  return new Response(response.body,{status:response.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
 }catch{return Response.json({detail:'Task service is temporarily unavailable.'},{status:503});}
}
export const GET=proxy;
export const POST=proxy;
