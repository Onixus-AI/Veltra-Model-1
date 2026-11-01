import type { Metadata } from "next";
import "./globals.css";
import "@/styles/workspace.css";
import "@/styles/veltra-theme.css";
import "@/styles/spatial-workspace.css";
import {WorkspaceAppearanceSync} from "@/components/workspace-appearance";
import WorkspaceFrame from "@/components/workspace-frame";
import "@/styles/workspace-foundation.css";
import AuthGate from "@/components/auth-gate";

export const metadata: Metadata = {
  icons: { icon: "/brands/onixus-workspace-icon-v2.png", apple: "/brands/onixus-workspace-icon-v2.png" },
  title: "Onixus Workspace — Build. Grow. Automate.",
  description: "Chat, email and customer relationships in one connected Onixus workspace.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body><WorkspaceAppearanceSync/><AuthGate><WorkspaceFrame>{children}</WorkspaceFrame></AuthGate></body>
    </html>
  );
}

