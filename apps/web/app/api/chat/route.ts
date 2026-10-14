import { NextRequest } from "next/server";
import { gatewayAuthorization, gatewayUrl } from "@/lib/gateway";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const authorization = gatewayAuthorization(request);

  const upstream = await fetch(`${gatewayUrl()}/v1/chat/completions`, {
    method: "POST",
    headers: {
      ...(authorization ? { Authorization: authorization } : {}),
      "Content-Type": "application/json",
      Accept: "text/event-stream, application/json",
    },
    body: await request.text(),
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
