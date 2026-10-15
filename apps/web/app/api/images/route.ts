import { NextRequest } from "next/server";
import { gatewayAuthorization, gatewayUrl } from "@/lib/gateway";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function POST(request: NextRequest) {
  const authorization = gatewayAuthorization(request);
  try {
    const upstream = await fetch(`${gatewayUrl()}/v1/images/generations`, {
      method: "POST", headers: { ...(authorization ? { Authorization: authorization } : {}), "Content-Type": "application/json" },
      body: await request.text(), cache: "no-store", signal: AbortSignal.timeout(165000),
    });
    return new Response(upstream.body, { status: upstream.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ detail: "Image creation is temporarily unavailable. Please try again shortly." }, { status: 503 });
  }
}
