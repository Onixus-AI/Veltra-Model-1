import { NextRequest } from "next/server";
import { gatewayAuthorization, gatewayUrl } from "@/lib/gateway";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const authorization = gatewayAuthorization(request);

  const upstream = await fetch(`${gatewayUrl()}/v1/usage`, {
    headers: {
      ...(authorization ? { Authorization: authorization } : {}),
      Accept: "application/json",
    },
    cache: "no-store",
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "Content-Type": upstream.headers.get("content-type") ?? "application/json" },
  });
}
