"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import WorkspaceNavigation from "./workspace-navigation";
import WorkspaceCommandMenu from "./workspace-command-menu";
import {
  activeWorkspaceTool,
  workspaceHref,
  workspaceTools,
} from "@/lib/workspace-navigation";
import { useWorkspaceDrawer } from "@/lib/use-workspace-drawer";
import { useWorkspaceBusiness } from "@/lib/workspace-business";

const publicPages = [
  "/book",
  "/eula",
  "/privacy",
  "/docs",
  "/support",
  "/revenue/paid",
  "/revenue/preview",
  "/workspace/join",
];
export default function WorkspaceFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname(),
    business = useWorkspaceBusiness();
  const [framed, setFramed] = useState<boolean | null>(null),
    [open, setOpen] = useState(false),
    [collapsed, setCollapsed] = useState(false),
    [search, setSearch] = useState("");
  const navigation = useRef<HTMLElement>(null),
    toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setFramed(window.parent !== window);
    setSearch(location.search);
    setOpen(false);
    try {
      setCollapsed(localStorage.getItem("veltra-sidebar-v1") === "false");
    } catch {}
  }, [pathname]);
  const mobile = useWorkspaceDrawer(
    open,
    () => setOpen(false),
    navigation,
    toggle,
  );
  if (pathname === "/" || publicPages.includes(pathname) || framed === true)
    return <>{children}</>;
  if (framed === null) return <p role="status">Opening workspace…</p>;
  return (
    <div
      className={
        "workspace-frame" + (!mobile && collapsed ? " sidebar-collapsed" : "")
      }
      data-navigation-open={open}
    >
      <a className="workspace-skip-link" href="#workspace-content">
        Skip to content
      </a>
      <header className="workspace-frame-header">
        <button
          ref={toggle}
          type="button"
          aria-label={
            mobile
              ? open
                ? "Close workspace navigation"
                : "Open workspace navigation"
              : collapsed
                ? "Expand navigation"
                : "Collapse navigation"
          }
          aria-expanded={mobile ? open : !collapsed}
          aria-controls="workspace-frame-navigation"
          onClick={() => {
            if (mobile) setOpen(!open);
            else {
              setCollapsed(!collapsed);
              try {
                localStorage.setItem("veltra-sidebar-v1", String(collapsed));
              } catch {}
            }
          }}
        >
          {(mobile ? open : !collapsed) ? (
            <PanelLeftClose size={20} />
          ) : (
            <PanelLeftOpen size={20} />
          )}
        </button>
        <Link
          href={workspaceHref("overview", business)}
          className="workspace-frame-brand"
        >
          <img src="/veltra-logo.png" alt="" width={30} height={30} />
          <span>Onixus Workspace</span>
        </Link>
        <WorkspaceCommandMenu
          commands={workspaceTools.map((tool) => ({
            id: tool.id,
            label: "Open " + tool.label,
            run: () => location.assign(workspaceHref(tool.id, business)),
          }))}
        />
      </header>
      <aside
        ref={navigation}
        role={open && mobile ? "dialog" : undefined}
        aria-modal={open && mobile ? true : undefined}
        aria-label="Workspace navigation"
        id="workspace-frame-navigation"
        className="workspace-frame-navigation"
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("a")) setOpen(false);
        }}
      >
        <WorkspaceNavigation
          business={business}
          active={activeWorkspaceTool(pathname, search)}
        />
      </aside>
      {open && mobile && (
        <button
          type="button"
          className="workspace-navigation-backdrop"
          aria-label="Close workspace navigation"
          onClick={() => {
            setOpen(false);
            toggle.current?.focus();
          }}
        />
      )}
      <div
        inert={open && mobile}
        id="workspace-content"
        className="workspace-frame-content"
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}
