import { NextRequest } from "next/server";
export const runtime = "nodejs";
export const maxDuration = 300;
type Context = { params: Promise<{ path: string[] }> };
async function proxy(request: NextRequest, context: Context) {
  const { path } = await context.params;
  const safe = path.every(part => /^[a-zA-Z0-9@._%+-]+$/.test(part) && part !== "." && part !== "..");
  const isApi = path[0] === "api";
  const isAsset = path[0] === "assets";
  const isPublicImage = path.length === 1 && path[0] === "veltra-hero.webp";
  const isApp = path.length === 1 && path[0] === "app";
  if (!safe || !(isApi || isAsset || isApp || isPublicImage)) return new Response("Not found", { status: 404 });
  const token = request.cookies.get("veltra_mail_frame")?.value;
  if (!token) return Response.json({ error: "Mail session expired. Reopen Mail from the canvas." }, { status: 401 });
  if (request.method !== "GET" && (!request.headers.get("origin") || !URL.canParse(request.headers.get("origin")!) || new URL(request.headers.get("origin")!).host !== request.headers.get("host") || request.headers.get("x-veltra-mail-frame") !== "1")) return new Response("Forbidden", { status: 403 });
  const base = process.env.VELTRA_MAIL_URL;
  if (!base) return new Response("Mail is not configured", { status: 503 });
  const route = isApi ? `/chat/platform/${path.map(encodeURIComponent).join("/")}` : isApp ? "/chat/platform/app" : `/${path.map(encodeURIComponent).join("/")}`;
  try {
    const upstream = await fetch(base.replace(/\/$/, "") + route + request.nextUrl.search, {
      method: request.method, headers: { Authorization: `Bearer ${token}`, "Content-Type": request.headers.get("content-type") ?? "application/json" },
      body: ["GET", "HEAD"].includes(request.method) ? undefined : await request.text(), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(290_000),
    });
    const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
    const headers = { "Content-Type": contentType, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...(isApp ? { "Content-Security-Policy": "frame-ancestors 'self'" } : {}) };
    if (isApp && upstream.ok) {
      const html = (await upstream.text()).replaceAll('="/assets/', '="/api/mail/platform/assets/');
      return new Response(html, { headers });
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch { return Response.json({ error: "Mail is temporarily unavailable. Reopen Mail to retry." }, { status: 502 }); }
}
export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
