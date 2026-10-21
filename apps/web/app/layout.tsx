import type { Metadata } from "next";
import "./globals.css";
import "@/styles/workspace.css";
import "@/styles/veltra-theme.css";
import "@/styles/spatial-workspace.css";
import AuthGate from "@/components/auth-gate";

export const metadata: Metadata = {
  icons: { icon: "/veltra-logo.png", apple: "/veltra-logo.png" },
  title: "Veltra — Think at the speed of now",
  description: "Chat, email and customer relationships in one connected Veltra workspace.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body><AuthGate>{children}</AuthGate></body>
    </html>
  );
}

