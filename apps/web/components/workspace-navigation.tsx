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
  type WorkspacePreferences,
  type WorkspaceToolId,
} from "@/lib/workspace-navigation";
import {useWorkspaceSettings} from "./workspace-settings-provider";
import WorkspaceAppearance from "./workspace-appearance";
const icons = {
  overview: LayoutDashboard,
  pathway: SlidersHorizontal,
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
export default function WorkspaceNavigation({
  business = "",
  active,
  onOpen,
}: {
  business?: string;
  active?: WorkspaceToolId | null;
  onOpen?: (id: WorkspaceToolId) => boolean;
}) {
  const settings=useWorkspaceSettings(),preferences=settings.layout;
  const [editing,setEditing]=useState(false),[saving,setSaving]=useState(false),[notice,setNotice]=useState('');
  const [draft,setDraft]=useState<WorkspacePreferences>(preferences);
  const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null),saveVersion=useRef(0);
  useEffect(()=>{saveVersion.current++;setEditing(false);setSaving(false);setNotice('');},[settings.userId]);
  useEffect(() => {
    if (editing) dialog.current?.showModal();
    else dialog.current?.close();
  }, [editing]);
  function close() {
    setEditing(false);
    trigger.current?.focus();
  }
  async function save() {
    const version=++saveVersion.current;setSaving(true);setNotice('');
    try{await settings.saveLayout(readWorkspacePreferences(draft));if(version===saveVersion.current)close();}
    catch(e){if(version===saveVersion.current)setNotice(e instanceof Error?e.message:'Workspace could not be saved.');}
    finally{if(version===saveVersion.current)setSaving(false);}
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
            disabled={!settings.canSave}
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
        {(settings.error||!settings.ready)&&<p role="status" className="workspace-preference-status">{settings.error||'Loading your workspace…'}{settings.error&&<button type="button" onClick={()=>void settings.refresh()}>Retry loading preferences</button>}</p>}
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
        <fieldset className="workspace-layout-fields" aria-label="Workspace layout" disabled={saving}><label>
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
          {settings.account?'Save your workspace to your account to use it across devices.':'Preferences are saved in this browser.'} Hiding tools does not change business access.
        </p>
        {settings.account&&!settings.hasLayout&&settings.hasBrowserLayout&&<button type="button" onClick={()=>{setSaving(true);void settings.importBrowserLayout().then(close).catch(e=>setNotice(e.message)).finally(()=>setSaving(false));}}>Import previous browser layout</button>}
        </fieldset>
        {notice && <p role="alert">{notice}</p>}
        <footer>
          <button
            type="button"
            disabled={saving}
            onClick={() => setDraft(readWorkspacePreferences(null))}
          >
            Reset tools
          </button>
          <button type="button" disabled={saving} onClick={close}>
            Cancel
          </button>
          <button type="button" className="primary" disabled={saving||!settings.canSave} onClick={()=>void save()}>
            {saving?"Saving…":"Save workspace"}
          </button>
        </footer>
      </dialog>
    </>
  );
}
