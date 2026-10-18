import { NextRequest } from "next/server";

export async function mailProxy(request: NextRequest, path: "link" | "inbox" | "tms" | "shopify" | `shopify/${string}`) {
  const origin = process.env.VELTRA_MAIL_URL;
  if (!origin) return Response.json({ error: "Veltra Mail connection is not configured yet." }, { status: 503 });
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return Response.json({ error: "Sign in to Chat first." }, { status: 401 });
  try {
    const upstream = await fetch(`${origin.replace(/\/$/, "")}/chat/${path}`, {
      method: request.method,
      headers: { Authorization: authorization, "Content-Type": "application/json" },
      body: request.method === "POST" ? JSON.stringify(await request.json()) : undefined,
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000),
    });
    return new Response(upstream.body, { status: upstream.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Veltra Mail is temporarily unavailable. Please try again." }, { status: 502 });
  }
}

