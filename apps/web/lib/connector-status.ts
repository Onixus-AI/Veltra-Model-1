// One list of every live connector and how its status reads. The page asks
// each service for its own status; this file only turns those answers into
// the same five states so every card looks and behaves the same way.

export type ConnectorState = "checking" | "connected" | "available" | "setup" | "unavailable";
export type ConnectorGroup = "Email & calendar" | "Files" | "Build & deploy" | "Research" | "Business";
export type ConnectorId =
  | "gmail" | "calendar" | "drive" | "github" | "vercel" | "supabase" | "n8n"
  | "firecrawl" | "crm" | "shopify" | "signal" | "bee";

export type Connector = {
  id: ConnectorId;
  name: string;
  logo: string;
  group: ConnectorGroup;
  description: string;
  /** included = provided by Onixus, nothing for the person to authorize. */
  kind?: "included";
};

export const CONNECTORS: Connector[] = [
  { id: "gmail", name: "Gmail", logo: "Gmail", group: "Email & calendar", description: "Onyx reads, sorts, drafts and sends mail you approve." },
  { id: "calendar", name: "Google Calendar", logo: "Google Calendar", group: "Email & calendar", description: "Meetings, availability and reviewed invitations." },
  { id: "drive", name: "Google Drive", logo: "Google Drive", group: "Files", description: "Find files and create or edit Docs and Sheets after review." },
  { id: "github", name: "GitHub", logo: "GitHub", group: "Build & deploy", description: "Read code, propose changes and open pull requests." },
  { id: "vercel", name: "Vercel", logo: "Vercel", group: "Build & deploy", description: "See projects and deployments beside your code." },
  { id: "supabase", name: "Supabase", logo: "Supabase", group: "Build & deploy", description: "Keep a database project's details beside Chat." },
  { id: "n8n", name: "n8n", logo: "n8n", group: "Build & deploy", description: "Choose a workflow to run and inspect from Chat." },
  { id: "firecrawl", name: "Firecrawl", logo: "Firecrawl", group: "Research", description: "Web search and page reading for Onyx and CRM research.", kind: "included" },
  { id: "crm", name: "Onixus CRM", logo: "Onixus CRM", group: "Business", description: "Customers, deals, tasks and campaigns beside Chat." },
  { id: "shopify", name: "Shopify", logo: "Shopify", group: "Business", description: "Store catalog and reviewed product edits." },
  { id: "signal", name: "Signal", logo: "Signal", group: "Business", description: "Your linked marketing business inside Workspace." },
  { id: "bee", name: "LiveAskew / Bee", logo: "LiveAskew / Bee", group: "Business", description: "Your stylist, saved looks and Honey calendar." },
];

export const GROUP_ORDER: ConnectorGroup[] = ["Email & calendar", "Files", "Build & deploy", "Research", "Business"];

export type ConnectorStatus = { state: ConnectorState; account?: string; note?: string };

type Raw = Record<string, unknown> | null | undefined;
const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);

/** Status from a service that answers {connected, configured?, account?}. */
export function oauthStatus(raw: Raw, account?: string): ConnectorStatus {
  if (!raw || typeof raw.connected !== "boolean") return { state: "unavailable" };
  if (raw.connected) return { state: "connected", account };
  if (raw.configured === false) return { state: "setup", note: "Onixus still needs to finish setting this up." };
  return { state: "available" };
}

export function gmailStatus(raw: Raw): ConnectorStatus {
  if (!raw || typeof raw.connected !== "boolean") return { state: "unavailable" };
  if (raw.choose_workspace) return { state: "setup", note: "Sign in as the business owner to connect Gmail." };
  if (!raw.connected) return { state: "available" };
  const boxes = Array.isArray(raw.mailboxes) ? raw.mailboxes.filter((m): m is string => typeof m === "string") : [];
  const single = text((raw.mailbox as Raw)?.email);
  return { state: "connected", account: boxes.length ? boxes.join(" · ") : single };
}

export function googleStatus(raw: Raw): ConnectorStatus {
  return oauthStatus(raw, text((raw?.account as Raw)?.email));
}

export function developerStatus(connections: unknown, provider: string): ConnectorStatus {
  if (!Array.isArray(connections)) return { state: "unavailable" };
  const row = connections.find((c) => c && typeof c === "object" && (c as Raw)!.provider === provider) as Raw;
  if (!row) return { state: "unavailable" };
  const selection = text((row.selection as Raw)?.name);
  const account = text((row.account as Raw)?.name);
  if (row.connected) return { state: "connected", account: selection ?? account };
  if (!row.configured) return { state: "setup", note: "Onixus still needs to finish setting this up." };
  return { state: "available" };
}

export function shopifyStatus(raw: Raw): ConnectorStatus {
  return oauthStatus(raw, text(raw?.shop));
}

export function crmStatus(raw: Raw): ConnectorStatus {
  if (!raw || typeof raw.connected !== "boolean") return { state: "unavailable" };
  if (raw.connected) return { state: "connected" };
  if (raw.available === false) return { state: "setup", note: "Your plan does not include Onixus CRM yet." };
  return { state: "available" };
}

export function signalStatus(raw: Raw, business: string): ConnectorStatus {
  const rows = raw?.connections;
  if (!Array.isArray(rows)) return { state: "unavailable" };
  return rows.some((r) => r && typeof r === "object" && (r as Raw)!.workspace_id === business && business)
    ? { state: "connected" }
    : { state: "available" };
}

export function includedStatus(raw: Raw, key: string): ConnectorStatus {
  const row = raw?.[key] as Raw;
  if (!row || typeof row.connected !== "boolean") return { state: "unavailable" };
  return row.connected
    ? { state: "connected", account: "Included with Onixus" }
    : { state: "setup", note: "The Onixus owner adds this key in Workspace hosting settings." };
}

export function summarize(statuses: Partial<Record<ConnectorId, ConnectorStatus>>) {
  const values = CONNECTORS.map((c) => statuses[c.id]?.state ?? "checking");
  return {
    total: CONNECTORS.length,
    connected: values.filter((s) => s === "connected").length,
    attention: values.filter((s) => s === "setup" || s === "unavailable").length,
    checking: values.filter((s) => s === "checking").length,
  };
}
