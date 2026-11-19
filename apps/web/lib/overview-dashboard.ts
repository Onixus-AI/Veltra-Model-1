// Pure figures and chart geometry for the Overview dashboard. No React, no I/O,
// so every number shown on the page can be checked in tests.

export type Metrics = {
  leads: { total: number; discovery_imports: number };
  pipeline: { currencies: string[]; open_by_stage: Record<string, { count: number; value_cents: number }>; won: number; lost: number };
  outreach: { threads_sent: number; replies_received: number; awaiting_approval: number };
  bookings: { scheduled: number; upcoming: number };
  payments: { known: boolean; collected_cents: number; outstanding_cents: number };
  commitments: { overdue: number; due_today: number };
  failures: { failed_sends: number; dead_jobs: number; sync_problems: number; paused: boolean };
};
export type TrendBin = { at: string; sent: number; completed: number; contacts: number };
export type Tone = "up" | "down" | "neutral" | "warn" | "brand";
export type Change = { text: string; tone: Tone };

/** Percent change against the previous elapsed period, written for a badge. */
export function change(current: number, before: number | undefined | null, higherIsBetter = true): Change {
  if (before == null) return { text: "No comparison", tone: "neutral" };
  if (before === 0) return current ? { text: "New", tone: "brand" } : { text: "No change", tone: "neutral" };
  const pct = Math.round(((current - before) / before) * 100);
  if (pct === 0) return { text: "0%", tone: "neutral" };
  const better = pct > 0 === higherIsBetter;
  return { text: `${pct > 0 ? "↗ +" : "↘ "}${pct}%`, tone: better ? "up" : "down" };
}

/** Reply rate for the gauge: replies over sent threads, 0–100, or null when nothing was sent. */
export function replyRate(m: Metrics): number | null {
  const sent = m.outreach.threads_sent;
  if (!sent) return null;
  return Math.max(0, Math.min(100, Math.round((m.outreach.replies_received / sent) * 100)));
}

export type Stage = { name: string; count: number; value_cents: number; filled: number };
const STAGE_ORDER = ["lead", "new", "contacted", "replied", "meeting", "proposal", "quote", "quoted", "negotiation", "won", "lost"];
/** Pipeline stages in sales order, each with how many of `segments` bar blocks it fills. */
export function pipelineStages(m: Metrics, segments = 16): Stage[] {
  const entries = Object.entries(m.pipeline.open_by_stage);
  const peak = Math.max(1, ...entries.map(([, v]) => v.count));
  const rank = (name: string) => { const i = STAGE_ORDER.indexOf(name.toLowerCase()); return i < 0 ? STAGE_ORDER.length : i; };
  return entries
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([name, v]) => ({ name, count: v.count, value_cents: v.value_cents, filled: v.count ? Math.max(1, Math.round((v.count / peak) * segments)) : 0 }));
}

/** Smooth path through points (Catmull-Rom converted to cubic Béziers). */
export function smoothPath(points: [number, number][]): string {
  if (!points.length) return "";
  if (points.length === 1) return `M${points[0][0]},${points[0][1]}`;
  let d = `M${points[0][0].toFixed(1)},${points[0][1].toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i], p1 = points[i], p2 = points[i + 1], p3 = points[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

export type TrendGeometry = {
  width: number; height: number; peak: number;
  sent: [number, number][]; completed: [number, number][];
  columns: { x: number; width: number; height: number }[];
};
/** Lays the trend out in a width × height box with room for axes. */
export function trendGeometry(trend: TrendBin[], width = 640, height = 190): TrendGeometry {
  const left = 8, right = 8, top = 14, bottom = 26;
  const peak = Math.max(1, ...trend.flatMap((b) => [b.sent, b.completed, b.contacts]));
  const usable = width - left - right, step = trend.length > 1 ? usable / (trend.length - 1) : 0;
  const y = (v: number) => top + (1 - v / peak) * (height - top - bottom);
  const x = (i: number) => (trend.length > 1 ? left + i * step : width / 2);
  const columnWidth = Math.max(6, Math.min(28, (usable / Math.max(1, trend.length)) * 0.62));
  return {
    width, height, peak,
    sent: trend.map((b, i) => [x(i), y(b.sent)]),
    completed: trend.map((b, i) => [x(i), y(b.completed)]),
    columns: trend.map((b, i) => ({ x: x(i) - columnWidth / 2, width: columnWidth, height: Math.max(2, (b.contacts / peak) * (height - top - bottom)) })),
  };
}

/** The one thing Onyx suggests looking at first, from the live figures. */
export function onyxInsight(m: Metrics): { headline: string; detail: string; action: string; href: string; share: number } {
  if (m.failures.paused) return { headline: "Automation is paused.", detail: "Nothing will send until it is resumed.", action: "Review automation", href: "/revenue?view=automation", share: 1 };
  if (m.outreach.awaiting_approval > 0) {
    const n = m.outreach.awaiting_approval;
    return { headline: `${n} ${n === 1 ? "draft is" : "drafts are"} waiting for your approval.`, detail: "Quotes and replies go out only after you approve them.", action: `Review ${n} ${n === 1 ? "draft" : "drafts"}`, href: "/revenue?view=mail", share: Math.min(1, n / Math.max(n, 50)) };
  }
  if (m.commitments.overdue > 0) {
    const n = m.commitments.overdue;
    return { headline: `${n} ${n === 1 ? "commitment is" : "commitments are"} overdue.`, detail: "Clear or reschedule them so follow-ups stay on time.", action: "Open commitments", href: "/revenue?view=overview", share: Math.min(1, n / Math.max(n, 50)) };
  }
  const failed = m.failures.failed_sends + m.failures.dead_jobs;
  if (failed > 0) return { headline: `${failed} ${failed === 1 ? "job needs" : "jobs need"} a retry.`, detail: "Sends or workflows stopped and were not completed.", action: "Review failures", href: "/revenue?view=automation", share: 0.4 };
  return { headline: "Nothing urgent right now.", detail: "Queues are clear. Ask Onyx to plan the next growth move.", action: "Ask Onyx", href: "/?view=chat", share: 0 };
}

export function greeting(hour: number) {
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}
