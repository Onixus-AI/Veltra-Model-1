import { NextRequest } from "next/server";
import { gatewayAuthorization, gatewayUrl } from "@/lib/gateway";

export const runtime = "nodejs";

async function forward(request: NextRequest, method: "GET" | "POST" | "DELETE") {
  const authorization = gatewayAuthorization(request);
  if (!authorization) {
    return Response.json(
      { detail: "Browser access is not configured. Set VELTRA_BROWSER_API_KEY or provide a developer key." },
      { status: 503 },
    );
  }

  const endpoint = new URL(`${gatewayUrl()}/v1/keys`);
  if (method === "DELETE") {
    const keyId = request.nextUrl.searchParams.get("id");
    if (!keyId) return Response.json({ detail: "An API key ID is required." }, { status: 400 });
    endpoint.pathname += `/${encodeURIComponent(keyId)}`;
  }

  const upstream = await fetch(endpoint, {
    method,
    headers: {
      Authorization: authorization,
      Accept: "application/json",
      ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
    },
    ...(method === "POST" ? { body: await request.text() } : {}),
    cache: "no-store",
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "Content-Type": upstream.headers.get("content-type") ?? "application/json" },
  });
}

export function GET(request: NextRequest) {
  return forward(request, "GET");
}

export function POST(request: NextRequest) {
  return forward(request, "POST");
}

export function DELETE(request: NextRequest) {
  return forward(request, "DELETE");
}
