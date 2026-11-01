"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  LayoutDashboard,
  Users,
  MessageSquare,
  Contact,
  Mail,
  CalendarDays,
  Radio,
  FolderOpen,
  Globe,
  Code2,
  Palette,
  Plug,
  Settings,
  SlidersHorizontal,
  X,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import {
  workspaceTools,
  workspaceHref,
  readWorkspacePreferences,
  defaultWorkspacePreferences,
  type WorkspacePreferences,
  type WorkspaceToolId,
} from "@/lib/workspace-navigation";
import WorkspaceAppearance from "./workspace-appearance";
const icons = {
  overview: LayoutDashboard,
  team: Users,
  chat: MessageSquare,
  crm: Contact,
  mail: Mail,
  calendar: CalendarDays,
  signal: Radio,
  files: FolderOpen,
  websites: Globe,
  build: Code2,
  code: Code2,
  brand: Palette,
  connections: Plug,
  settings: Settings,
};
const preferenceKey = "onixus-workspace-tools-v1",
  preferenceEvent = "onixus:workspace-tools-changed";
export default function WorkspaceNavigation({
  business = "",
  active,
  onOpen,
}: {
  business?: string;
  active?: WorkspaceToolId | null;
  onOpen?: (id: WorkspaceToolId) => boolean;
}) {
  const [preferences, setPreferences] = useState<WorkspacePreferences>(
      defaultWorkspacePreferences,
    ),
    [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<WorkspacePreferences>(
      defaultWorkspacePreferences,
    ),
    [notice, setNotice] = useState("");
  const dialog = useRef<HTMLDialogElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const restore = () => {
      try {
        setPreferences(
          readWorkspacePreferences(
            JSON.parse(localStorage.getItem(preferenceKey) || "null"),
          ),
        );
      } catch {
        setPreferences(readWorkspacePreferences(null));
      }
    };
    restore();
    window.addEventListener(preferenceEvent, restore);
    window.addEventListener("storage", restore);
    return () => {
      window.removeEventListener(preferenceEvent, restore);
      window.removeEventListener("storage", restore);
    };
  }, []);
  useEffect(() => {
    if (editing) dialog.current?.showModal();
    else dialog.current?.close();
  }, [editing]);
  function close() {
    setEditing(false);
    trigger.current?.focus();
  }
  function save() {
    const next = readWorkspacePreferences(draft);
    try {
      localStorage.setItem(preferenceKey, JSON.stringify(next));
      window.dispatchEvent(new Event(preferenceEvent));
      setPreferences(next);
      setNotice("Workspace tools saved in this browser.");
      close();
    } catch {
      setNotice(
        "Your browser could not save these preferences. Allow browser storage and try again.",
      );
    }
  }
  function move(id: WorkspaceToolId, direction: number) {
    setDraft((previous) => {
      const tools = [...previous.tools],
        from = tools.indexOf(id),
        to = from + direction;
      if (from < 0 || to < 0 || to >= tools.length) return previous;
      [tools[from], tools[to]] = [tools[to], tools[from]];
      return { ...previous, tools };
    });
  }
  const visible = [...preferences.tools];
  // An open tool remains reachable even when it isn't pinned.
  if (
    active &&
    !["connections", "settings"].includes(active) &&
    !visible.includes(active)
  )
    visible.push(active);
  function item(id: WorkspaceToolId) {
    const tool = workspaceTools.find((tool) => tool.id === id)!,
      Icon = icons[id];
    return (
      <Link
        key={id}
        href={workspaceHref(id, business)}
        title={tool.label}
        aria-label={tool.label}
        aria-current={active === id ? "page" : undefined}
        onClick={(event) => {
          if (
            !event.metaKey &&
            !event.ctrlKey &&
            !event.shiftKey &&
            !event.altKey &&
            onOpen?.(id)
          )
            event.preventDefault();
        }}
      >
        <Icon size={18} />
        <span>{tool.label}</span>
      </Link>
    );
  }
  return (
    <>
      <nav className="workspace-tool-navigation" aria-label="Workspace tools">
        <span className="workspace-navigation-name">{preferences.name}</span>
        {visible.map(item)}
        <div className="workspace-navigation-settings">
          {item("connections")}
          {item("settings")}
          <WorkspaceAppearance navigation />
          <button
            ref={trigger}
            type="button"
            aria-haspopup="dialog"
            title="Customize tools"
            aria-label="Customize tools"
            onClick={() => {
              setDraft({ ...preferences, tools: [...preferences.tools] });
              setNotice("");
              setEditing(true);
            }}
          >
            <SlidersHorizontal size={18} />
            <span>Customize tools</span>
          </button>
        </div>
      </nav>
      <dialog
        ref={dialog}
        className="workspace-preferences-dialog"
        aria-labelledby="workspace-preferences-title"
        onCancel={close}
        onClose={() => setEditing(false)}
      >
        <header>
          <h2 id="workspace-preferences-title">Your workspace</h2>
          <button
            type="button"
            aria-label="Close workspace customization"
            onClick={close}
          >
            <X size={18} />
          </button>
        </header>
        <p>
          Choose and order your tools. Hiding a tool keeps its data and
          connection.
        </p>
        <label>
          Workspace name
          <input
            value={draft.name}
            maxLength={60}
            onChange={(event) =>
              setDraft({ ...draft, name: event.target.value })
            }
          />
        </label>
        <fieldset>
          <legend>Tools in your navigation</legend>
          {[
            ...draft.tools,
            ...workspaceTools
              .map((tool) => tool.id)
              .filter(
                (id) =>
                  !draft.tools.includes(id) &&
                  id !== "connections" &&
                  id !== "settings",
              ),
          ].map((id) => {
            const tool = workspaceTools.find((tool) => tool.id === id)!,
              index = draft.tools.indexOf(id);
            return (
              <div className="workspace-preference-tool" key={id}>
                <label>
                  <input
                    type="checkbox"
                    checked={index >= 0}
                    onChange={(event) =>
                      setDraft((previous) => ({
                        ...previous,
                        tools: event.target.checked
                          ? [...previous.tools, id]
                          : previous.tools.filter((tool) => tool !== id),
                      }))
                    }
                  />
                  {tool.label}
                </label>
                {index >= 0 && (
                  <div>
                    <button
                      type="button"
                      aria-label={"Move " + tool.label + " up"}
                      disabled={index === 0}
                      onClick={() => move(id, -1)}
                    >
                      <ArrowUp size={16} />
                    </button>
                    <button
                      type="button"
                      aria-label={"Move " + tool.label + " down"}
                      disabled={index === draft.tools.length - 1}
                      onClick={() => move(id, 1)}
                    >
                      <ArrowDown size={16} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </fieldset>
        <p>
          Preferences are saved in this browser. They do not change business
          access.
        </p>
        {notice && <p role="status">{notice}</p>}
        <footer>
          <button
            type="button"
            onClick={() => setDraft(readWorkspacePreferences(null))}
          >
            Reset tools
          </button>
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={save}>
            Save workspace
          </button>
        </footer>
      </dialog>
    </>
  );
}
