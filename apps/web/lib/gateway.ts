import { NextRequest } from "next/server";

export function gatewayAuthorization(request: NextRequest): string | null {
  const authorization = request.headers.get("authorization");
  return authorization?.startsWith("Bearer ") ? authorization : null;
}

export function gatewayUrl(): string {
  return (
    process.env.AI_GATEWAY_URL ??
    process.env.NEXT_PUBLIC_VELTRA_API_URL ??
    "http://localhost:8000"
  ).replace(/\/$/, "");
}
