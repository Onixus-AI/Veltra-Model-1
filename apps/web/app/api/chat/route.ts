import { VELOCITY_CONVERSATION_STYLE } from "@/lib/conversation-style";
import { NextRequest } from "next/server";
import { gatewayAuthorization, gatewayUrl } from "@/lib/gateway";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const authorization = gatewayAuthorization(request);
  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.messages)) {
    return Response.json({detail:"Send a valid conversation."},{status:400});
  }
  const messages = [{role:"system",content:VELOCITY_CONVERSATION_STYLE},...payload.messages];

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
