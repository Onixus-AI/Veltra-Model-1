"use client";
import { useEffect, useState } from "react";
import { gatewayAuthorizationHeaders } from "@/lib/client-session";
import type { WorkspaceToolId } from "@/lib/workspace-navigation";

export type NavigationCount = { value: number; tone: "urgent" | "warn" | "neutral"; label: string };
type Metrics = { outreach?: { awaiting_approval?: unknown }; commitments?: { overdue?: unknown } };

/** Counts beside sidebar items, from the business overview. Zero or unknown shows nothing. */
export function navigationCounts(metrics: Metrics | null | undefined): Partial<Record<WorkspaceToolId, NavigationCount>> {
  const counts: Partial<Record<WorkspaceToolId, NavigationCount>> = {};
  const review = metrics?.outreach?.awaiting_approval, overdue = metrics?.commitments?.overdue;
  if (typeof review === "number" && review > 0) counts.mail = { value: review, tone: "warn", label: `${review} drafts awaiting your review` };
  if (typeof overdue === "number" && overdue > 0) counts.crm = { value: overdue, tone: "urgent", label: `${overdue} overdue commitments` };
  return counts;
}

export function useNavigationCounts(business: string) {
  const [counts, setCounts] = useState<Partial<Record<WorkspaceToolId, NavigationCount>>>({});
  useEffect(() => {
    setCounts({});
    if (!business) return;
    let live = true;
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch("/api/workspace/overview?period=today&workspace=" + encodeURIComponent(business), {
          headers: await gatewayAuthorizationHeaders(), cache: "no-store",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
        });
        if (!response.ok) return;
        const data = await response.json();
        if (live && data.workspace === business) setCounts(navigationCounts(data.overview?.metrics));
      } catch { /* counts are a convenience; the pages show the real queues */ }
    };
    void load();
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 60000);
    return () => { live = false; controller.abort(); clearInterval(timer); };
  }, [business]);
  return counts;
}
