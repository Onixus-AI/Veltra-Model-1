import { NextRequest } from "next/server";
import { gatewayAuthorization, gatewayUrl } from "@/lib/gateway";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const authorization = gatewayAuthorization(request);
  if (!authorization) {
    return Response.json(
      { detail: "Browser access is not configured. Set VELTRA_BROWSER_API_KEY or provide a developer key." },
      { status: 503 },
    );
  }

  const upstream = await fetch(`${gatewayUrl()}/v1/account`, {
    headers: { Authorization: authorization, Accept: "application/json" },
    cache: "no-store",
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "Content-Type": upstream.headers.get("content-type") ?? "application/json" },
  });
}
