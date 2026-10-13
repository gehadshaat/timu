import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Timu — your Claude team",
  description: "Your Claude sessions as projects, teams and the things that need you.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
