"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Bell,
  FlaskConical,
  Gem,
  Home,
  LayoutGrid,
  LogOut,
  Monitor,
  Moon,
  MoreHorizontal,
  Search,
  Sun,
  TrendingUp,
  User,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useSession } from "@/lib/session";
import { useUnreadCount } from "@/lib/notifications";
import { Avatar } from "./Avatar";
import cfg from "@/monsoc.config";

type NavItem = { href: string; label: string; icon: LucideIcon; plugin?: keyof typeof cfg.plugins; auth?: boolean; mobile?: boolean };

const NAV: NavItem[] = [
  { href: "/", label: "Home", icon: Home, mobile: true },
  { href: "/search", label: "Search", icon: Search, mobile: true },
  { href: "/markets", label: "Markets", icon: TrendingUp, plugin: "markets", mobile: true },
  { href: "/notifications", label: "Notifications", icon: Bell, auth: true, mobile: true },
  { href: "/communities", label: "Communities", icon: Users },
  { href: "/feeds", label: "Feeds", icon: LayoutGrid },
  { href: "/trials", label: "Trials", icon: FlaskConical, plugin: "trials" },
  { href: "/scouts", label: "Scouts", icon: Gem, plugin: "scouts" },
  { href: "/wallet", label: "Wallet", icon: Wallet },
];

export function Logo({ size = 30 }: { size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-[30%] font-display font-extrabold text-white shadow-soft"
      style={{ width: size, height: size, fontSize: size * 0.55, backgroundImage: "linear-gradient(135deg, var(--accent), var(--accent-2))" }}
    >
      {cfg.name.slice(0, 1).toLowerCase()}
    </span>
  );
}

export function Shell({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  const path = usePathname();
  const { fid, profile } = useSession();
  const unread = useUnreadCount(fid);
  const [more, setMore] = useState(false);
  const items = NAV.filter((n) => (!n.plugin || cfg.plugins[n.plugin]) && (!n.auth || fid));
  const profileHref = fid ? `/u/${profile?.handle ?? fid}` : "/login";
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  return (
    <div className="mx-auto flex min-h-screen max-w-[1200px]">
      {/* ---------------------------------------------------------- desktop sidebar */}
      <nav className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-0.5 px-3 py-5 md:flex">
        <Link href="/" className="mb-6 flex items-center gap-2.5 px-3">
          <Logo />
          <span className="font-display text-xl font-bold tracking-tight">{cfg.name}</span>
        </Link>
        {items.map((n) => (
          <NavLink key={n.href} item={n} on={active(n.href)} badge={n.href === "/notifications" ? unread : 0} />
        ))}
        {fid && <NavLink item={{ href: profileHref, label: "Profile", icon: User }} on={path === profileHref} />}
        <div className="mt-auto">
          <AccountMenu />
        </div>
      </nav>

      <main className="min-w-0 flex-1 border-x border-line bg-panel/60 pb-24 backdrop-blur-sm md:pb-0">{children}</main>
      {aside && <aside className="sticky top-0 hidden h-screen w-[320px] shrink-0 space-y-4 overflow-y-auto px-4 py-5 lg:block">{aside}</aside>}

      {/* ---------------------------------------------------------- mobile tab bar */}
      <nav className="fixed inset-x-3 bottom-3 z-30 flex justify-around rounded-2xl border border-line bg-panel/90 px-1 py-1.5 shadow-pop backdrop-blur-xl md:hidden">
        {items
          .filter((n) => n.mobile)
          .map((n) => (
            <MobileTab key={n.href} href={n.href} icon={n.icon} label={n.label === "Notifications" ? "Alerts" : n.label} on={active(n.href)} dot={n.href === "/notifications" && unread > 0} />
          ))}
        <button className="flex flex-1 flex-col items-center gap-0.5 rounded-xl py-1 text-[10px] font-medium text-muted" onClick={() => setMore(!more)}>
          <MoreHorizontal size={20} />
          More
        </button>
      </nav>
      {more && (
        <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setMore(false)}>
          <div className="absolute inset-x-3 bottom-20 animate-pop rounded-2xl border border-line bg-panel p-2 shadow-pop" onClick={(e) => e.stopPropagation()}>
            {items
              .filter((n) => !n.mobile)
              .concat([{ href: profileHref, label: fid ? "Profile" : "Log in", icon: User }])
              .map((n) => (
                <Link key={n.href} href={n.href} onClick={() => setMore(false)} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium hover:bg-panel-2">
                  <n.icon size={18} className="text-muted" /> {n.label}
                </Link>
              ))}
            <ThemeSwitch />
          </div>
        </div>
      )}
    </div>
  );
}

function NavLink({ item, on, badge = 0 }: { item: NavItem; on: boolean; badge?: number }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] transition ${
        on ? "bg-panel font-semibold text-text shadow-soft" : "text-muted hover:bg-panel/70 hover:text-text"
      }`}
    >
      <Icon size={20} strokeWidth={on ? 2.4 : 1.9} className={on ? "text-accent" : "transition group-hover:text-text"} />
      {item.label}
      {badge > 0 && (
        <span className="ml-auto rounded-full px-1.5 text-[10px] font-bold leading-[18px] text-white" style={{ backgroundImage: "linear-gradient(135deg, var(--accent), var(--accent-2))" }}>
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </Link>
  );
}

function MobileTab({ href, icon: Icon, label, on, dot }: { href: string; icon: LucideIcon; label: string; on: boolean; dot?: boolean }) {
  return (
    <Link href={href} className={`relative flex flex-1 flex-col items-center gap-0.5 rounded-xl py-1 text-[10px] font-medium ${on ? "text-accent" : "text-muted"}`}>
      <Icon size={20} strokeWidth={on ? 2.4 : 1.9} />
      {label}
      {dot && <span className="absolute right-[30%] top-0.5 h-2 w-2 rounded-full bg-coral ring-2 ring-panel" />}
    </Link>
  );
}

export function PageHeader({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-panel/80 px-5 py-3.5 backdrop-blur-xl">
      <Link href="/" className="md:hidden">
        <Logo size={28} />
      </Link>
      <div className="min-w-0">
        <h1 className="font-display text-xl font-bold leading-tight">{title}</h1>
        {sub && <p className="truncate text-xs text-muted">{sub}</p>}
      </div>
      <div className="ml-auto">{right}</div>
    </header>
  );
}

// ------------------------------------------------------------------ theme

type Theme = "system" | "light" | "dark";

function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>("system");
  useEffect(() => {
    const t = localStorage.getItem("monsoc.theme");
    if (t === "light" || t === "dark") setTheme(t);
  }, []);
  const set = (t: Theme) => {
    setTheme(t);
    if (t === "system") {
      localStorage.removeItem("monsoc.theme");
      delete document.documentElement.dataset.theme;
    } else {
      localStorage.setItem("monsoc.theme", t);
      document.documentElement.dataset.theme = t;
    }
  };
  return [theme, set];
}

function ThemeSwitch() {
  const [theme, setTheme] = useTheme();
  const opts: [Theme, LucideIcon, string][] = [
    ["light", Sun, "Light"],
    ["dark", Moon, "Dark"],
    ["system", Monitor, "Auto"],
  ];
  return (
    <div className="m-1 flex rounded-xl bg-panel-2 p-1">
      {opts.map(([t, Icon, label]) => (
        <button
          key={t}
          onClick={() => setTheme(t)}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition ${theme === t ? "bg-panel text-text shadow-soft" : "text-muted hover:text-text"}`}
        >
          <Icon size={14} /> {label}
        </button>
      ))}
    </div>
  );
}

/** Signed in: profile card that opens Profile / Wallet / theme / Log out. Signed out: Sign up + Log in. */
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
      <div className="space-y-2 px-1">
        <Link href="/onboarding" className="btn-primary w-full">Create account</Link>
        <Link href="/login" className="btn-ghost w-full">Log in</Link>
        <ThemeSwitch />
      </div>
    );

  const handle = profile?.handle ?? String(fid);
  return (
    <div ref={ref} className="relative">
      {open && (
        <div className="absolute bottom-full left-0 mb-2 w-full animate-pop overflow-hidden rounded-2xl border border-line bg-panel p-1 shadow-pop">
          <Link href={`/u/${handle}`} className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm hover:bg-panel-2" onClick={() => setOpen(false)}>
            <User size={16} className="text-muted" /> View profile
          </Link>
          <Link href="/wallet" className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm hover:bg-panel-2" onClick={() => setOpen(false)}>
            <Wallet size={16} className="text-muted" /> Wallet & keys
          </Link>
          <ThemeSwitch />
          <button
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm text-bad hover:bg-panel-2"
            onClick={() => {
              setOpen(false);
              logout();
              router.push("/");
            }}
          >
            <LogOut size={16} /> Log out @{handle}
          </button>
        </div>
      )}
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2.5 rounded-2xl p-2 text-left transition hover:bg-panel hover:shadow-soft">
        <Avatar fid={fid} handle={profile?.handle} src={profile?.avatar} size={36} />
        <div className="min-w-0 flex-1 text-sm">
          <div className="truncate font-semibold">{profile?.displayName ?? `@${handle}`}</div>
          <div className="truncate text-xs text-muted">
            @{handle}
            {profile?.scoutTier ? ` · ${profile.scoutTier} scout` : ""}
          </div>
        </div>
        <MoreHorizontal size={16} className="text-muted" />
      </button>
    </div>
  );
}

