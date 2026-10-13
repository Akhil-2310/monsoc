import type { Metadata } from "next";
import { Bricolage_Grotesque, Inter } from "next/font/google";
import "./globals.css";
import { SessionProvider } from "@/lib/session";
import cfg from "@/monsoc.config";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const bricolage = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-bricolage", display: "swap", weight: ["500", "600", "700", "800"] });

export const metadata: Metadata = {
  title: cfg.name,
  description: cfg.tagline,
};

// Apply a saved theme before first paint so there's no light/dark flash.
const themeScript = `try{var t=localStorage.getItem("monsoc.theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const accent = cfg.theme.accent
    ? `:root{--accent:${cfg.theme.accent.light}}` +
      `@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--accent:${cfg.theme.accent.dark}}}` +
      `:root[data-theme="dark"]{--accent:${cfg.theme.accent.dark}}`
    : "";
  return (
    <html lang="en" className={`${inter.variable} ${bricolage.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {accent && <style dangerouslySetInnerHTML={{ __html: accent }} />}
      </head>
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
