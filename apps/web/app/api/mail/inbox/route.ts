import { NextRequest } from "next/server";
import { mailProxy } from "@/lib/mail-proxy";
export const runtime = "nodejs";
export const GET = (request: NextRequest) => mailProxy(request, "inbox");
