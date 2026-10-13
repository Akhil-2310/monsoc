import type { Metadata } from "next";
import "./globals.css";
import { SessionProvider } from "@/lib/session";
import cfg from "@/monsoc.config";

export const metadata: Metadata = {
  title: cfg.name,
  description: cfg.tagline,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ ["--accent" as string]: cfg.theme.accent, ["--accent-soft" as string]: cfg.theme.accentSoft }}>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
