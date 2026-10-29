import { NextRequest } from "next/server";
import { billingRedirect } from "@/lib/billing";
import { gatewayAuthorization } from "@/lib/gateway";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
 const authorization = gatewayAuthorization(request);
 if (!authorization) {
 return Response.json({ detail: "Sign in to manage billing." }, { status: 401 });
 }
 const apiBase = process.env.ONIXUS_API_URL?.replace(/\/$/, "");
 if (!apiBase) {
 return Response.json({ detail: "Onixus billing is not configured yet." }, { status: 503 });
 }
 const body = await request.json().catch(() => null);
 const action = body?.action === "portal" ? "portal" : "checkout";
 // New packages require verified plan-specific pricing and cost-backed metering.
 // Preserve existing customers’ billing portal; never enroll new plans as the legacy generic SKU.
 if (action === "checkout") return Response.json({ detail: "New Workspace packages are available by scope request. Contact Onixus to confirm your plan, setup and credit terms before payment." }, { status: 409 });
 const origin = request.nextUrl.origin;
 let upstream: Response;
 try {
 upstream = await fetch(`${apiBase}/v1/billing/${action}`, {
 method: "POST",
 headers: { Authorization: authorization, "Content-Type": "application/json", Accept: "application/json" },
 body: JSON.stringify({
 plan: "veltra-monthly",
 success_url: `${origin}/settings?billing=success`,
 cancel_url: `${origin}/settings?billing=cancel`,
 }),
 cache: "no-store",
 redirect: "error",
 signal: AbortSignal.timeout(20000),
 });
 } catch {
 return Response.json({ detail: "Onixus billing could not be reached." }, { status: 502 });
 }
 const payload = await upstream.json().catch(() => ({}));
 if (!upstream.ok) {
 const detail = typeof payload.detail === "string" ? payload.detail : typeof payload.error === "string" ? payload.error : "Stripe billing could not be opened.";
 return Response.json({ detail }, { status: upstream.status });
 }
 const url = billingRedirect(typeof payload.url === "string" ? payload.url : "", apiBase);
 if (!url) return Response.json({ detail: "Onixus did not return a Stripe billing link." }, { status: 502 });
 return Response.json({ url });
}
