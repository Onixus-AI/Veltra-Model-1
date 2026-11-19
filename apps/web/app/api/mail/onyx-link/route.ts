import { NextRequest } from "next/server";
import { mailProxy } from "@/lib/mail-proxy";

export const runtime = "nodejs";

// Onyx's link to the Mail service is distinct from Workspace's Gmail grant.
// The Mail service authenticates the same Workspace user and owns the link.
export const GET = (request: NextRequest) => mailProxy(request, "link");
export const POST = (request: NextRequest) => mailProxy(request, "link");
export const DELETE = (request: NextRequest) => mailProxy(request, "link");
