import type { Metadata } from "next";
import "./globals.css";
import "@/styles/workspace.css";
import "@/styles/veltra-theme.css";
import "@/styles/spatial-workspace.css";
import AuthGate from "@/components/auth-gate";

export const metadata: Metadata = {
  icons: { icon: "/brands/onixus-gravity-v1.png", apple: "/brands/onixus-gravity-v1.png" },
  title: "Onixus Workspace — Build. Grow. Automate.",
  description: "Chat, email and customer relationships in one connected Onixus workspace.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body><AuthGate>{children}</AuthGate></body>
    </html>
  );
}

