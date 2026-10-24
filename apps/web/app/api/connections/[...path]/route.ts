import {requireTaskAccess,type AccessApp} from '@/lib/task-access';
import {crmError} from '@/lib/crm/server';
import { NextRequest } from "next/server";
export const runtime="nodejs";
export const maxDuration=120;
async function proxy(request:NextRequest,context:{params:Promise<{path:string[]}>}) {
  const {path}=await context.params;
  const allowed=path.length===1&&path[0]==="status"||["github","vercel","supabase","railway","n8n"].includes(path[0])&&path.length<=2&&(!path[1]||["start","resources","select","tree","file","pull-request","change-set","pull-request-set","checks","deployments","project"].includes(path[1]));
  if(!allowed)return new Response("Not found",{status:404});
  const authorization=request.headers.get("authorization");
  if(!authorization?.startsWith("Bearer "))return Response.json({error:"Sign in to Veltra first."},{status:401});
  const base=process.env.VELTRA_MAIL_URL;
  if(!base)return Response.json({error:"Workspace connections are not configured."},{status:503});
  try {
    const task=request.headers.get("x-veltra-task");if(task){const permission=await requireTaskAccess(request,task,[path[0]==="status"?"connections":path[0] as AccessApp]);if(permission)return permission;}
    const suffix=path[0]==="status"?"":path.map(encodeURIComponent).join("/");
    const response=await fetch(`${base.replace(/\/$/,"")}/chat/connections/${suffix}${request.nextUrl.search}`,{method:request.method,headers:{authorization,"Content-Type":"application/json"},body:request.method==="GET"?undefined:await request.text(),cache:"no-store",redirect:"error",signal:AbortSignal.timeout(100_000)});
    if(!response.headers.get("content-type")?.includes("application/json"))return Response.json({error:"Workspace connections are temporarily unavailable. Please try again shortly."},{status:502});
    return new Response(response.body,{status:response.status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
  }catch(error){if(error instanceof Error&&/^\d{3}:/.test(error.message))return crmError(error);return Response.json({error:"This connection is temporarily unavailable. Try again."},{status:502});}
}
export const GET=proxy;
export const POST=proxy;
export const DELETE=proxy;
