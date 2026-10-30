import {usageActivity} from '@/lib/usage-activity';
import { NextRequest } from "next/server";
import { gatewayAuthorization, gatewayUrl } from "@/lib/gateway";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const authorization = gatewayAuthorization(request);

  const query = new URLSearchParams();
  for (const key of ["month", "day"]) { const value = request.nextUrl.searchParams.get(key); if (value) query.set(key,value); }
  const upstream = await fetch(`${gatewayUrl()}/v1/usage?${query}`, {
    headers: {
      ...(authorization ? { Authorization: authorization } : {}),
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if(!upstream.ok)return new Response(upstream.body,{status:upstream.status,headers:{'Content-Type':upstream.headers.get('content-type')??'application/json','Cache-Control':'no-store'}});
  const body=await upstream.json();
  const observed=await usageActivity(request,body);
  return Response.json({...body,...observed},{headers:{'Cache-Control':'no-store'}});
}
