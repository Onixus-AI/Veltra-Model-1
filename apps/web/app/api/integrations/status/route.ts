import { NextRequest } from "next/server";

export const runtime = "nodejs";

// Server-held integrations that Onixus provides to every workspace. Reports
// only whether each is configured; never returns a key or any part of one.
export async function GET(request: NextRequest) {
  if (!request.headers.get("authorization")?.startsWith("Bearer ")) {
    return Response.json({ error: "Sign in to Onixus Workspace first." }, { status: 401 });
  }
  return Response.json(
    { firecrawl: { connected: Boolean(process.env.FIRECRAWL_API_KEY?.trim()) } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
