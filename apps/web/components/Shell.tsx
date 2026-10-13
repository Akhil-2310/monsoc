"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSession } from "@/lib/session";
import { useUnreadCount } from "@/lib/notifications";
import { Avatar } from "./Avatar";
import cfg from "@/monsoc.config";

const NAV = [
  { href: "/", label: "Home", icon: "⌂" },
  { href: "/search", label: "Search", icon: "⌕" },
  { href: "/notifications", label: "Notifications", icon: "♪", auth: true },
  { href: "/communities", label: "Communities", icon: "◍" },
  { href: "/feeds", label: "Feeds", icon: "≋" },
  { href: "/trials", label: "Trials", icon: "◎", plugin: "trials" as const },
  { href: "/scouts", label: "Scouts", icon: "◆", plugin: "scouts" as const },
  { href: "/wallet", label: "Wallet", icon: "$" },
];

export function Shell({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  const path = usePathname();
  const { fid, profile } = useSession();
  const unread = useUnreadCount(fid);
  const items = NAV.filter((n) => (!n.plugin || cfg.plugins[n.plugin]) && (!("auth" in n) || fid));
  const badge = (href: string) =>
    href === "/notifications" && unread > 0 ? (
      <span className="ml-auto rounded-full bg-accent px-1.5 text-[10px] font-semibold leading-4 text-white">{unread > 99 ? "99+" : unread}</span>
    ) : null;
  const profileHref = fid ? `/u/${profile?.handle ?? fid}` : "/login";

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl">
      <nav className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col gap-1 border-r border-line p-4 md:flex">
        <Link href="/" className="mb-4 px-3 text-xl font-bold tracking-tight">
          <span className="text-accent">◉</span> {cfg.name}
        </Link>
        {items.map((n) => (
          <Link key={n.href} href={n.href} className={`tab flex items-center gap-3 text-[15px] ${path === n.href ? "tab-on" : ""}`}>
            <span className="w-4 text-center">{n.icon}</span> {n.label}
            {badge(n.href)}
          </Link>
        ))}
        {fid && (
          <Link href={profileHref} className={`tab flex items-center gap-3 text-[15px] ${path === profileHref ? "tab-on" : ""}`}>
            <span className="w-4 text-center">☺</span> Profile
          </Link>
        )}
        <div className="mt-auto">
          <AccountMenu />
        </div>
      </nav>

      <main className="min-w-0 flex-1 border-r border-line pb-20 md:pb-0">{children}</main>
      {aside && <aside className="sticky top-0 hidden h-screen w-80 shrink-0 overflow-y-auto p-4 lg:block">{aside}</aside>}

      <nav className="fixed inset-x-0 bottom-0 z-10 flex justify-around border-t border-line bg-bg/95 py-2 backdrop-blur md:hidden">
        {items.map((n) => (
          <Link key={n.href} href={n.href} className={`relative flex flex-col items-center px-1 text-[10px] ${path === n.href ? "text-accent" : "text-muted"}`}>
            <span className="text-lg leading-none">{n.icon}</span>
            {n.label === "Notifications" ? "Alerts" : n.label}
            {n.href === "/notifications" && unread > 0 && <span className="absolute right-0 top-0 h-2 w-2 rounded-full bg-accent" />}
          </Link>
        ))}
        <Link href={profileHref} className={`flex flex-col items-center px-2 text-[10px] ${path === profileHref ? "text-accent" : "text-muted"}`}>
          <span className="text-lg leading-none">☺</span>
          {fid ? "Profile" : "Log in"}
        </Link>
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

/** Signed in: profile card that opens Profile / Wallet / Log out. Signed out: Sign up + Log in. */
function AccountMenu() {
  const { fid, profile, ready, logout } = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (!ready) return null;
  if (!fid)
    return (
      <div className="space-y-2">
        <Link href="/onboarding" className="btn-primary w-full">Sign up</Link>
        <Link href="/login" className="btn-ghost w-full">Log in</Link>
      </div>
    );

  const handle = profile?.handle ?? String(fid);
  return (
    <div ref={ref} className="relative">
      {open && (
        <div className="absolute bottom-full left-0 mb-2 w-full overflow-hidden rounded-xl border border-line bg-panel shadow-xl">
          <Link href={`/u/${handle}`} className="block px-4 py-2.5 text-sm hover:bg-panel-2" onClick={() => setOpen(false)}>
            View profile
          </Link>
          <Link href="/wallet" className="block px-4 py-2.5 text-sm hover:bg-panel-2" onClick={() => setOpen(false)}>
            Wallet & keys
          </Link>
          <button
            className="block w-full border-t border-line px-4 py-2.5 text-left text-sm text-bad hover:bg-panel-2"
            onClick={() => {
              setOpen(false);
              logout();
              router.push("/");
            }}
          >
            Log out @{handle}
          </button>
        </div>
      )}
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 rounded-xl p-2 text-left hover:bg-panel">
        <Avatar fid={fid} handle={profile?.handle} src={profile?.avatar} size={32} />
        <div className="min-w-0 flex-1 text-sm">
          <div className="truncate font-semibold">{profile?.displayName ?? `@${handle}`}</div>
          <div className="truncate text-xs text-muted">{profile?.displayName ? `@${handle} · ` : ""}fid {fid}{profile?.scoutTier ? ` · ${profile.scoutTier} scout` : ""}</div>
        </div>
        <span className="text-muted">⋯</span>
      </button>
    </div>
  );
}
