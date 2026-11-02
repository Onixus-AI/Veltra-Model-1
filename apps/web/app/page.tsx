import { redirect } from "next/navigation";
import VeltraWorkspace from "@/components/veltra-workspace";
import { workspaceHref } from "@/lib/workspace-navigation";

type Query = Record<string, string | string[] | undefined>;
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Query>;
}) {
  const query = await searchParams;
  // Keep existing direct tool/chat links; the default entry is the workspace home.
  if (!query.canvas && query.view !== "chat" && !query.prompt && !query.mode) {
    const supplied = query.workspace ?? query.crm_workspace;
    redirect(
      workspaceHref("overview", typeof supplied === "string" ? supplied : ""),
    );
  }
  return <VeltraWorkspace />;
}
