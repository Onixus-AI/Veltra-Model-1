import React from "react";

export type UsageSlice = { name: string; credits: number; requests: number };
export type UsageDay = { date: string } & Record<string, number | string>;
export type UsageReport = {
  credits_used: number;
  requests: number;
  by_surface: UsageSlice[];
  by_activity: UsageSlice[];
  daily_credits: UsageDay[];
  daily_requests: UsageDay[];
  daily_work: UsageDay[];
};

const SURFACES = ["Mail", "CRM", "Chat", "Super Coder", "Connectors"];
const ACTIVITIES = ["Building", "Reasoning", "Images", "Video", "Other"];
const SURFACE_COLOR: Record<string, string> = { Mail: "#71d7aa", CRM: "#e7b975", Chat: "#b9a9ff", "Super Coder": "#7eb6ff", Connectors: "#c4c1cc" };
const ACTIVITY_COLOR: Record<string, string> = { Building: "#7eb6ff", Reasoning: "#b9a9ff", Images: "#e7b975", Video: "#71d7aa", Other: "#c4c1cc" };

function days(report: UsageReport | null, key: "daily_credits" | "daily_requests" | "daily_work", names: string[]): UsageDay[] {
  if (report?.[key]?.length) return report[key];
  const today = new Date();
  return Array.from({ length: 30 }, (_, index) => {
    const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 29 + index));
    const row: UsageDay = { date: day.toISOString().slice(0, 10) };
    for (const name of names) row[name] = 0;
    return row;
  });
}

function Metric({ title, caption, total, series, keys, colors, value }: { title: string; caption: string; total: string; series: UsageDay[]; keys: string[]; colors: Record<string, string>; value: (day: UsageDay, key: string) => number }) {
  const totals = series.map((day) => keys.reduce((sum, key) => sum + value(day, key), 0));
  const max = Math.max(1, ...totals, 1);
  const legend = keys.map((key) => ({ key, amount: series.reduce((sum, day) => sum + value(day, key), 0) }));
  return (
    <article className="settings-card usage-metric">
      <h3>{title}</h3>
      <strong>{total}</strong>
      <p>{caption}</p>
      <div className="usage-bars" aria-hidden="true">
        {series.map((day, index) => (
          <div className="usage-bar" key={day.date}>
            {keys.map((key) => {
              const amount = value(day, key);
              if (amount <= 0) return null;
              return <span key={key} style={{ height: `${(amount / max) * 100}%`, background: colors[key] }} />;
            })}
            {totals[index] <= 0 && <span className="usage-bar-empty" />}
          </div>
        ))}
      </div>
      <ul className="usage-legend">
        {legend.map((item) => (
          <li key={item.key}>
            <span><i style={{ background: colors[item.key] }} />{item.key}</span>
            <b>{item.amount.toLocaleString()}</b>
          </li>
        ))}
      </ul>
    </article>
  );
}

export function usageFromAccount(account: { usage?: UsageReport; consumption?: { date: string; credits: number }[] } | null): UsageReport | null {
  if (account?.usage) return account.usage;
  if (!account?.consumption?.length) return null;
  const credits = account.consumption.reduce((sum, day) => sum + day.credits, 0);
  return {
    credits_used: credits,
    requests: 0,
    by_surface: SURFACES.map((name) => ({ name, credits: name === "Chat" ? credits : 0, requests: 0 })),
    by_activity: ACTIVITIES.map((name) => ({ name, credits: name === "Reasoning" ? credits : 0, requests: 0 })),
    daily_credits: account.consumption.map((day) => ({ date: day.date, Mail: 0, CRM: 0, Chat: day.credits, "Super Coder": 0, Connectors: 0 })),
    daily_requests: [],
    daily_work: account.consumption.map((day) => ({ date: day.date, Building: 0, Reasoning: day.credits, Images: 0, Video: 0, Other: 0 })),
  };
}

export default function UsageBoard({ usage }: { usage: UsageReport | null }) {
  const number = (value: number) => value.toLocaleString();
  return (
    <div className="usage-board">
      <Metric title="Credits" caption="Last 30 days" total={number(usage?.credits_used ?? 0)} series={days(usage, "daily_credits", SURFACES)} keys={SURFACES} colors={SURFACE_COLOR} value={(day, key) => Number(day[key] ?? 0)} />
      <Metric title="Requests" caption="Where the work happened" total={number(usage?.requests ?? 0)} series={days(usage, "daily_requests", SURFACES)} keys={SURFACES} colors={SURFACE_COLOR} value={(day, key) => Number(day[key] ?? 0)} />
      <Metric title="Work" caption="Building, reasoning, images, and video" total={number(usage?.by_activity?.reduce((sum, item) => sum + Math.max(0, item.credits), 0) ?? 0)} series={days(usage, "daily_work", ACTIVITIES)} keys={ACTIVITIES} colors={ACTIVITY_COLOR} value={(day, key) => Number(day[key] ?? 0)} />
    </div>
  );
}
