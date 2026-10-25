import { NextRequest, NextResponse } from "next/server";
import { mailProxy } from "@/lib/mail-proxy";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin || !URL.canParse(origin) || new URL(origin).host !== request.headers.get("host")) return Response.json({ error: "Open Mail from your workspace." }, { status: 403 });
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return Response.json({ error: "Sign in first." }, { status: 401 });
  // Check live authorization before granting this browser a short frame session.
  const probe = new NextRequest(new URL("/api/mail/link", request.url), { headers: { authorization } });
  const status = await mailProxy(probe, "link");
  if (!status.ok) return status;
  const data = await status.json();
  if (!data.connected) return Response.json({ error: "Connect Onixus Mail first." }, { status: 409 });
  const response = NextResponse.json({ url: "/api/mail/platform/app" });
  response.cookies.set("veltra_mail_frame", authorization.slice(7), { httpOnly: true, secure: request.nextUrl.protocol === "https:", sameSite: "strict", path: "/api/mail/platform", maxAge: 240 });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
