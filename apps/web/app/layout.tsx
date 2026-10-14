import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Veltra — Think at the speed of now",
  description: "Your AI workspace for ideas, code, and everything in between.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
