import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PilotAudit — AI Website QA & Audit Engine",
  description: "Audit AI-generated dental and healthcare marketing websites for broken CTAs, dead phone links, placeholder text, SEO gaps and mobile layout defects.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
