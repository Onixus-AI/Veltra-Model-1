import type { Metadata } from "next";
import "./globals.css";
import AuthGate from "@/components/auth-gate";

export const metadata: Metadata = {
  title: "Veltra — Think at the speed of now",
  description: "Your AI workspace for ideas, code, and everything in between.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body><AuthGate>{children}</AuthGate></body>
    </html>
  );
}
