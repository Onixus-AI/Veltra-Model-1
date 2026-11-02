import test from "node:test";
import assert from "node:assert/strict";
import {
  workspaceTools,
  workspaceHref,
  workspaceBusiness,
  activeWorkspaceTool,
  readWorkspacePreferences,
} from "../lib/workspace-navigation";
import { readAppearance } from "../lib/workspace-appearance";

test("every shared destination carries business context without changing its destination", () => {
  for (const tool of workspaceTools) {
    const href = workspaceHref(tool.id, "a business / & +");
    const url = new URL(href, "https://workspace.example");
    assert.equal(url.pathname, tool.path);
    assert.equal(workspaceBusiness(url.search), "a business / & +");
    if (tool.path === "/")
      assert.equal(url.searchParams.get("crm_workspace"), "a business / & +");
  }
});
test("navigation handles existing business links and routes to the most specific tool", () => {
  assert.equal(workspaceBusiness("?crm_workspace=legacy"), "legacy");
  assert.equal(
    workspaceBusiness("?workspace=current&crm_workspace=old"),
    "current",
  );
  assert.equal(activeWorkspaceTool("/workspace/team"), "team");
  assert.equal(activeWorkspaceTool("/workspace/files"), "files");
  assert.equal(activeWorkspaceTool("/settings/connections"), "connections");
  assert.equal(activeWorkspaceTool("/crm"), "crm");
  assert.equal(activeWorkspaceTool("/", "?canvas=mail"), "mail");
  assert.equal(activeWorkspaceTool("/", "?canvas=crm"), "crm");
  assert.equal(activeWorkspaceTool("/", "?view=chat"), "chat");
  assert.equal(activeWorkspaceTool("/unknown"), null);
});
test("saved tools keep user order, deduplicate and discard unavailable or permanent entries", () => {
  assert.deepEqual(
    readWorkspacePreferences({
      version: 1,
      name: "  Operations  ",
      tools: ["mail", "crm", "mail", "unknown", "settings", "connections"],
    }).tools,
    ["mail", "crm"],
  );
  assert.equal(
    readWorkspacePreferences({ version: 1, name: "  Operations  ", tools: [] })
      .name,
    "Operations",
  );
  assert.deepEqual(
    readWorkspacePreferences({ version: 1, name: "Empty", tools: [] }).tools,
    [],
  );
  assert.ok(
    readWorkspacePreferences({ version: 2, tools: ["bad"] }).tools.includes(
      "overview",
    ),
  );
  const first = readWorkspacePreferences(null);
  first.tools.length = 0;
  assert.ok(readWorkspacePreferences(null).tools.length > 0);
});
test("appearance migrates previous accents and safely rejects malformed preferences", () => {
  assert.equal(readAppearance({ accent: "violet" }).accent, "purple");
  assert.equal(readAppearance({ accent: "emerald" }).accent, "lime");
  assert.equal(
    readAppearance({ theme: "light", density: "compact" }).theme,
    "light",
  );
  assert.deepEqual(
    readAppearance({ theme: "invalid", accent: "url()", density: 20 }),
    { version: 1, theme: "dark", accent: "cyan", density: "comfortable" },
  );
});
