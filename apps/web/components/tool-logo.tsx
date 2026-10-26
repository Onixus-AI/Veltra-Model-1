import { CalendarDays, Plug, Scissors, Sparkles, Truck, Users } from "lucide-react";

const brandAssets: Record<string, string> = {
  Signal: "onixus-signal-icon-v2.png",
  "Onixus TMS": "onixus-tms-gold.png",
  "Veltra Mail": "onixus-mail-icon-v2.png", "Veltra CRM": "onixus-crm-icon-v2.png", "Onixus Mail": "onixus-mail-icon-v2.png", "Onixus CRM": "onixus-crm-icon-v2.png",
  "LiveAskew / Bee": "liveaskew.png",
  GitHub: "github.svg", Vercel: "vercel.svg", Supabase: "supabase.svg",
  n8n: "n8n.svg", Railway: "railway.svg", Gmail: "gmail.png",
  "Google Docs": "googledocs.png", "Google Sheets": "googlesheets.png",
  "Google Slides": "googleslides.png", "Google Calendar": "googlecalendar.png",
  "Google Drive": "googledrive.png", "Google Workspace": "google.png",
  HubSpot: "hubspot.svg", Slack: "slack.png", QuickBooks: "quickbooks.svg",
  Shopify: "shopify.svg", "TikTok Shop": "tiktok.svg", Higgsfield: "higgsfield.png",
  Canva: "canva.webp", Remotion: "remotion.png", LinkedIn: "linkedin.svg",
  Discord: "discord.svg", Telegram: "telegram.svg", Notion: "notion.svg",
  OneDrive: "onedrive.svg", SharePoint: "sharepoint.svg",
};
const workspaceIcons = {
  Dispatcher: Truck, "Event Planning": CalendarDays, Stylist: Sparkles,
  Barber: Scissors, "Community Manager": Users,
  "Custom MCP Server": Plug,
};

export default function ToolLogo({ name }: { name: string }) {
  const file = brandAssets[name];
  const veltra = name.startsWith("Veltra");
  const Icon = workspaceIcons[name as keyof typeof workspaceIcons] ?? Plug;
  return <span className={`hub-tool-icon brand-logo ${veltra ? "veltra-tool-logo" : ""}`} aria-hidden="true">
    {file || veltra
      ? <img src={file ? `/brands/${file}` : "/veltra-logo.png"} alt="" width={24} height={24} loading="lazy" />
      : <Icon size={20} />}
  </span>;
}

