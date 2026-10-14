import { NextRequest } from "next/server";

export function gatewayAuthorization(request: NextRequest): string | null {
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer veltra_sk_")) return authorization;

  const browserApiKey = process.env.VELTRA_BROWSER_API_KEY;
  return browserApiKey?.startsWith("veltra_sk_") ? `Bearer ${browserApiKey}` : null;
}

export function gatewayUrl(): string {
  return (process.env.AI_GATEWAY_URL ?? "http://localhost:8000").replace(/\/$/, "");
}
