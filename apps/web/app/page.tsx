import { redirect } from "next/navigation";
import { headers } from "next/headers";
import VeltraWorkspace from "@/components/veltra-workspace";
import { workspaceHref } from "@/lib/workspace-navigation";

type Query = Record<string, string | string[] | undefined>;
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Query>;
}) {
  const query = await searchParams;
  // Signal's embedded sign-in is bound to the canonical Workspace origin.
  // Old Veltra links must enter there before the cross-origin handshake starts.
  if (query.canvas === "signal" && (await headers()).get("host") === "veltra-model-1.vercel.app") {
    const params = new URLSearchParams();
    for (const [key, values] of Object.entries(query)) {
      for (const value of Array.isArray(values) ? values : values === undefined ? [] : [values]) params.append(key, value);
    }
    redirect(`https://workspace.onixus.xyz/?${params.toString()}`);
  }
  // Keep existing direct tool/chat links; the default entry is the workspace home.
  if (!query.canvas && query.view !== "chat" && !query.prompt && !query.mode) {
    const supplied = query.workspace ?? query.crm_workspace;
    redirect(
      workspaceHref("overview", typeof supplied === "string" ? supplied : ""),
    );
  }
  return <VeltraWorkspace />;
}
