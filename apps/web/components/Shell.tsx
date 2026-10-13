"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useSession } from "@/lib/session";
import { Avatar } from "./Avatar";
import cfg from "@/monsoc.config";

const NAV = [
  { href: "/", label: "Home", icon: "⌂" },
  { href: "/communities", label: "Communities", icon: "◍" },
  { href: "/feeds", label: "Feeds", icon: "≋" },
  { href: "/trials", label: "Trials", icon: "◎", plugin: "trials" as const },
  { href: "/scouts", label: "Scouts", icon: "◆", plugin: "scouts" as const },
  { href: "/wallet", label: "Wallet", icon: "$" },
];

export function Shell({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  const path = usePathname();
  const { fid, profile, ready } = useSession();
  const items = NAV.filter((n) => !n.plugin || cfg.plugins[n.plugin]);

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl">
      <nav className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col gap-1 border-r border-line p-4 md:flex">
        <Link href="/" className="mb-4 px-3 text-xl font-bold tracking-tight">
          <span className="text-accent">◉</span> {cfg.name}
        </Link>
        {items.map((n) => (
          <Link key={n.href} href={n.href} className={`tab flex items-center gap-3 text-[15px] ${path === n.href ? "tab-on" : ""}`}>
            <span className="w-4 text-center">{n.icon}</span> {n.label}
          </Link>
        ))}
        <div className="mt-auto">
          {ready && fid ? (
            <Link href={`/u/${profile?.handle ?? fid}`} className="flex items-center gap-2 rounded-xl p-2 hover:bg-panel">
              <Avatar fid={fid} handle={profile?.handle} size={32} />
              <div className="min-w-0 text-sm">
                <div className="truncate font-semibold">@{profile?.handle ?? fid}</div>
                <div className="text-xs text-muted">fid {fid}{profile?.scoutTier ? ` · ${profile.scoutTier} scout` : ""}</div>
              </div>
            </Link>
          ) : (
            ready && <Link href="/onboarding" className="btn-primary w-full">Sign up</Link>
          )}
        </div>
      </nav>

      <main className="min-w-0 flex-1 border-r border-line pb-20 md:pb-0">{children}</main>
      {aside && <aside className="sticky top-0 hidden h-screen w-80 shrink-0 overflow-y-auto p-4 lg:block">{aside}</aside>}

      <nav className="fixed inset-x-0 bottom-0 z-10 flex justify-around border-t border-line bg-bg/95 py-2 backdrop-blur md:hidden">
        {items.map((n) => (
          <Link key={n.href} href={n.href} className={`flex flex-col items-center px-2 text-[10px] ${path === n.href ? "text-accent" : "text-muted"}`}>
            <span className="text-lg leading-none">{n.icon}</span>
            {n.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

export function PageHeader({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-bg/85 px-4 py-3 backdrop-blur">
      <div className="min-w-0">
        <h1 className="text-lg font-bold">{title}</h1>
        {sub && <p className="truncate text-xs text-muted">{sub}</p>}
      </div>
      <div className="ml-auto">{right}</div>
    </header>
  );
}
