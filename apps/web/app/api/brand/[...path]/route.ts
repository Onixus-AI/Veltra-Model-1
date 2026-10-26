import {NextRequest} from 'next/server';
export const runtime='nodejs';
export const maxDuration=60;
async function proxy(request:NextRequest,context:{params:Promise<{path:string[]}>}){
 const route=(await context.params).path.join('/');
 const methods:Record<string,string>={files:'GET',download:'GET',upload:'POST',remove:'POST',restore:'POST'};
 if(!methods[route])return new Response('Not found',{status:404});
 if(request.method!==methods[route])return new Response('Method not allowed',{status:405});
 const authorization=request.headers.get('authorization');
 if(!authorization?.startsWith('Bearer '))return Response.json({error:'Sign in to Onixus Workspace first.'},{status:401});
 if(request.headers.has('x-veltra-task'))return Response.json({error:'Brand files require their signed-in owner.'},{status:403});
 const base=process.env.VELTRA_MAIL_URL;
 if(!base)return Response.json({error:'Brand folder is not configured.'},{status:503});
 if(Number(request.headers.get('content-length'))>4_500_000)return Response.json({error:'File too large.'},{status:413});
 try{
  const body=request.method==='POST'?await request.text():undefined;
  if(body&&body.length>4_500_000)return Response.json({error:'File too large.'},{status:413});
  const response=await fetch(`${base.replace(/\/$/,'')}/chat/brand/${route==='files'?'':route}${request.nextUrl.search}`,{method:request.method,headers:{authorization,'Content-Type':'application/json'},body,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(50_000)});
  if(response.status===404)return Response.json({error:'Brand folder or file is unavailable.'},{status:404});
  const headers=new Headers({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'"});
  for(const key of ['content-type','content-disposition']){const value=response.headers.get(key);if(value)headers.set(key,value);}
  return new Response(response.body,{status:response.status,headers});
 }catch{return Response.json({error:'Brand folder is temporarily unavailable.'},{status:502});}
}
export const GET=proxy;export const POST=proxy;
