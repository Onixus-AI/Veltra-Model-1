/** Shared navigation metadata. No React, browser storage, or authorization logic. */
export const workspaceTools = [
  { id: "overview", label: "Overview", path: "/workspace" },
  { id: "pathway", label: "Build & Growth", path: "/workspace/build" },
  { id: "team", label: "Business team", path: "/workspace/team" },
  { id: "chat", label: "Onyx", path: "/", view: "chat" },
  { id: "crm", label: "CRM", path: "/", canvas: "crm" },
  { id: "mail", label: "Mail", path: "/", canvas: "mail" },
  { id: "calendar", label: "Calendar", path: "/", canvas: "calendar" },
  { id: "signal", label: "Signal", path: "/", canvas: "signal" },
  { id: "files", label: "Docs & Sheets", path: "/workspace/files" },
  { id: "websites", label: "Websites", path: "/websites" },
  { id: "build", label: "Super Coder", path: "/", canvas: "build" },
  { id: "code", label: "Code", path: "/", canvas: "code" },
  { id: "brand", label: "Brand files", path: "/workspace/brand" },
  { id: "connections", label: "Connections", path: "/settings/connections" },
  { id: "settings", label: "Settings", path: "/settings" },
] as const;
export type WorkspaceToolId = (typeof workspaceTools)[number]["id"];
export type CanvasTool =
  | "crm"
  | "mail"
  | "calendar"
  | "signal"
  | "build"
  | "code";
export function workspaceHref(id: WorkspaceToolId, business = "") {
  const tool = workspaceTools.find((tool) => tool.id === id)!;
  const query = new URLSearchParams();
  if ("canvas" in tool) query.set("canvas", tool.canvas);
  if ("view" in tool) query.set("view", tool.view);
  if (business) query.set("workspace", business);
  // Preserve the existing chat API's context parameter during migration.
  if (business && tool.path === "/") query.set("crm_workspace", business);
  return tool.path + (query.size ? "?" + query : "");
}
export function workspaceBusiness(search: string) {
  const query = new URLSearchParams(search);
  return query.get("workspace") ?? query.get("crm_workspace") ?? "";
}
export function activeWorkspaceTool(
  pathname: string,
  search = "",
): WorkspaceToolId | null {
  if (pathname === "/workspace/growth") return "pathway";
  if (pathname === "/crm") return "crm";
  if (pathname === "/") {
    const query = new URLSearchParams(search),
      canvas = query.get("canvas");
    return (
      workspaceTools.find((tool) => "canvas" in tool && tool.canvas === canvas)
        ?.id ?? "chat"
    );
  }
  return (
    [...workspaceTools]
      .filter((tool) => tool.path !== "/")
      .sort((a, b) => b.path.length - a.path.length)
      .find(
        (tool) =>
          pathname === tool.path || pathname.startsWith(tool.path + "/"),
      )?.id ?? null
  );
}
export type WorkspacePreferences = {
  version: 1;
  name: string;
  tools: WorkspaceToolId[];
};
export const defaultWorkspacePreferences: WorkspacePreferences = {
  version: 1,
  name: "My workspace",
  tools: [
    "overview",
    "pathway",
    "team",
    "chat",
    "crm",
    "mail",
    "calendar",
    "signal",
    "files",
    "websites",
  ],
};
export function readWorkspacePreferences(value: unknown): WorkspacePreferences {
  if (!value || typeof value !== "object")
    return {
      ...defaultWorkspacePreferences,
      tools: [...defaultWorkspacePreferences.tools],
    };
  const saved = value as Partial<WorkspacePreferences>;
  if (saved.version !== 1 || !Array.isArray(saved.tools))
    return readWorkspacePreferences(null);
  const tools = [
    ...new Set(
      saved.tools.filter(
        (id) =>
          workspaceTools.some((tool) => tool.id === id) &&
          id !== "connections" &&
          id !== "settings",
      ),
    ),
  ];
  return {
    version: 1,
    name:
      typeof saved.name === "string" && saved.name.trim()
        ? saved.name.trim().slice(0, 60)
        : defaultWorkspacePreferences.name,
    tools,
  };
}
