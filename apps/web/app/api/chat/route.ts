import {connectionIntent,connectionSummary} from "@/lib/chat-connections";
import {beeIntent,beeChatResponse} from "@/lib/bee-chat";
import { VELOCITY_CONVERSATION_STYLE } from "@/lib/conversation-style";
import { NextRequest } from "next/server";
import { gatewayAuthorization, gatewayUrl } from "@/lib/gateway";

import {crmContext,crmError} from '@/lib/crm/server';
import {memoryPrompt} from '@/lib/crm/suite-domain';

export const runtime = "nodejs";
export const maxDuration=120;

export async function POST(request: NextRequest) {
  const authorization = gatewayAuthorization(request);
  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.messages)) {
    return Response.json({detail:"Send a valid conversation."},{status:400});
  }
  const last=payload.messages.at(-1);
  const connection=last?.role==='user'&&typeof last.content==='string'?connectionIntent(last.content):null;
  if(connection){
    if(!authorization)return Response.json({detail:'Sign in to use connected tools.'},{status:401});
    const base=process.env.VELTRA_MAIL_URL;
    if(!base)return Response.json({detail:'Connections are not configured.'},{status:503});
    try{
      const response=await fetch(base.replace(/\/$/,'')+'/chat/connections/'+(connection==='status'?'':connection),{headers:{Authorization:authorization},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(25000)});
      const data=await response.json();
      if(!response.ok)return Response.json({detail:data.error??'The connected tool could not complete this request.'},{status:response.status});
      return beeChatResponse(connectionSummary(connection,data),payload.stream===true);
    }catch{return Response.json({detail:'Connected tools are temporarily unavailable.'},{status:502});}
  }
  const bee=last?.role==='user'&&typeof last.content==='string'?beeIntent(last.content):null;
  if(bee){
    if(!authorization)return Response.json({detail:'Sign in to use Bee.'},{status:401});
    const base=process.env.VELTRA_MAIL_URL;
    if(!base)return Response.json({detail:'Bee connections are not configured.'},{status:503});
    try{
      const r=await fetch(base.replace(/\/$/,'')+'/chat/bee'+(bee.name==='status'?'':'/call'),{method:bee.name==='status'?'GET':'POST',headers:{Authorization:authorization,'Content-Type':'application/json'},body:bee.name==='status'?undefined:JSON.stringify(bee),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(100000)});
      const result=await r.json();
      if(!r.ok)return Response.json({detail:result.error??'Bee could not complete this request.'},{status:r.status});
      if(bee.name==='status')return beeChatResponse(result.connected?'Bee is connected. You can ask Bee for advice, show your Bee looks, read your Bee calendar, or get your Bee daily overview. Try “Ask Bee: what should I wear?” Advice uses your LiveAskew membership allowance.':'Bee is not connected. Open Connections → LiveAskew / Bee. Create a LiveAskew account first if needed, then connect Bee.',payload.stream===true);
      if(typeof result.text!=='string'||!result.receipt)return Response.json({detail:'Bee returned no action receipt.'},{status:502});
      return beeChatResponse(`Bee · ${result.isError?'Request could not complete':'LiveAskew'}\n\n${result.text}`,payload.stream===true);
    }catch{return Response.json({detail:'Bee is temporarily unavailable. Try again shortly.'},{status:502});}
  }
  let memory:unknown=null;
  if(payload.conversation_id){try{memory=await crmContext(request,payload.conversation_id);}catch(e){return crmError(e);}}
  const messages = [...(memory?[{role:'system',content:memoryPrompt(memory)}]:[]),{role:"system",content:VELOCITY_CONVERSATION_STYLE},...payload.messages];

  const upstream = await fetch(`${gatewayUrl()}/v1/chat/completions`, {
    method: "POST",
    headers: {
      ...(authorization ? { Authorization: authorization } : {}),
      "Content-Type": "application/json",
      Accept: "text/event-stream, application/json",
    },
    body: JSON.stringify({...payload,messages}),
    cache: "no-store",
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "application/json",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
