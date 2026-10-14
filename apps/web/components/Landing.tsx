"use client";
import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Check,
  FlaskConical,
  Fingerprint,
  Code2,
  LayoutGrid,
  Lock,
  Radar,
  ShieldCheck,
  TrendingUp,
  Users,
  UsersRound,
} from "lucide-react";
import { Logo } from "./Shell";
import { MarketCard } from "./MarketCard";
import { useLiveMarkets } from "@/lib/useMarkets";
import cfg from "@/monsoc.config";

const REPO = "https://github.com/Akhil-2310/monsoc";

const FEATURES = [
  {
    icon: Users,
    title: "Your audience is yours",
    body: "Followers live onchain, not in our database. Take them to any app built on the protocol, on day one.",
  },
  {
    icon: LayoutGrid,
    title: "Pick your algorithm",
    body: "Switch feeds in one tap: single-topic, real conversations, no engagement bait. Or publish your own.",
  },
  {
    icon: FlaskConical,
    title: "Test with strangers first",
    body: "Trial posts reach people who don't follow you yet. A/B two hooks, then release the winner.",
  },
  {
    icon: TrendingUp,
    title: "Back creators early",
    body: "Bet on follower milestones before the crowd. Early backers earn more, settled by the onchain graph.",
  },
  {
    icon: Radar,
    title: "Scout new talent",
    body: "Back creators you discover early. Your scout score grows as they do, counted in verified followers only.",
  },
  {
    icon: UsersRound,
    title: "Communities with rules",
    body: "Open, token-gated, invite-only or paid. Membership, roles and ranking are enforced onchain, not by a policy team.",
  },
];

const STEPS = [
  { icon: Fingerprint, title: "Sign up with a passkey", body: "Touch ID or Face ID creates your account and handle. No seed phrase, no wallet popup, no gas." },
  { icon: LayoutGrid, title: "Choose how you see the world", body: "Pick topic feeds and ranking styles. Every feed saves room for creators you don't follow yet." },
  { icon: TrendingUp, title: "Post, discover, back", body: "Trial posts on strangers, scout rising creators, and back the ones you believe in before the crowd." },
];

const STATS = [
  { value: "0", label: "seed phrases or gas fees" },
  { value: "5–30%", label: "of every feed saved for discovery" },
  { value: "1 tap", label: "to switch your algorithm" },
  { value: "100%", label: "of follows stored onchain" },
];

/** What signed-out visitors see at "/". The feed itself stays browsable at /explore. */
export function Landing() {
  const markets = useLiveMarkets();
  const featured = [...markets].sort((a, b) => Number(b.yesPool) + Number(b.noPool) - (Number(a.yesPool) + Number(a.noPool)))[0];

  return (
    <div className="min-h-screen">
      {/* ---------------------------------------------------------- top bar */}
      <header className="sticky top-0 z-30 border-b border-line/70 bg-bg/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-5 py-3.5">
          <Link href="/" className="flex items-center gap-2.5">
            <Logo />
            <span className="font-display text-xl font-bold tracking-tight">{cfg.name}</span>
          </Link>
          <nav className="ml-auto flex items-center gap-1">
            <a href="#features" className="tab hidden md:inline-flex">Features</a>
            <a href="#how" className="tab hidden md:inline-flex">How it works</a>
            <Link href="/markets" className="tab hidden sm:inline-flex">Markets</Link>
            <Link href="/explore" className="tab hidden sm:inline-flex">Explore</Link>
            <Link href="/login" className="btn-ghost ml-1">Log in</Link>
            <Link href="/onboarding" className="btn-primary hidden sm:inline-flex">Get started</Link>
          </nav>
        </div>
      </header>

      {/* ---------------------------------------------------------- hero */}
      <section className="relative overflow-hidden">
        {/* faint dot grid behind the hero */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-60 [background-image:radial-gradient(var(--line)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:linear-gradient(to_bottom,black,transparent_85%)]"
        />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 pb-20 pt-12 md:pt-20 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <span className="chip border border-line bg-panel py-1 text-muted shadow-soft">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-good opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-good" />
              </span>
              Live on Monad testnet
            </span>
            <h1 className="mt-6 font-display text-[44px] font-extrabold leading-[1.02] tracking-tight sm:text-6xl lg:text-[68px]">
              Social where reach is <span className="text-accent">earned</span>, and early fans <span className="text-accent">get paid</span>.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">
              An open social network where you own your identity, your audience and your feed. No platform decides who gets seen, and the
              people who spot talent early share in its success.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link href="/onboarding" className="btn-primary px-6 py-3 text-base">
                <Fingerprint size={18} /> Create account with passkey
              </Link>
              <Link href="/explore" className="btn-ghost px-6 py-3 text-base">
                Explore the feed <ArrowRight size={16} />
              </Link>
            </div>
            <div className="mt-9 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
              <span className="flex items-center gap-1.5"><ShieldCheck size={15} className="text-good" /> No seed phrase, no gas</span>
              <span className="flex items-center gap-1.5"><Lock size={15} className="text-accent" /> Followers stored onchain</span>
              <span className="flex items-center gap-1.5"><BadgeCheck size={15} className="text-accent" /> Every post verifiable</span>
            </div>
          </div>

          {/* a real live market, framed by two small product snippets */}
          <div className="relative mx-auto w-full max-w-md lg:max-w-none">
            <div className="absolute -left-6 -top-8 z-10 hidden rotate-[-4deg] sm:block">
              <div className="card flex items-center gap-2 px-3.5 py-2.5 shadow-pop">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-accent-soft text-accent"><LayoutGrid size={15} /></span>
                <div className="text-xs">
                  <p className="font-semibold">Feed: Real conversations</p>
                  <p className="text-muted">20% discovery slots</p>
                </div>
              </div>
            </div>
            {featured ? (
              <div className="rotate-[-1.5deg] transition hover:rotate-0">
                <MarketCard m={featured} inFeed />
              </div>
            ) : (
              <div className="card p-10 text-center text-muted">
                <TrendingUp className="mx-auto text-accent" />
                <p className="mt-2 text-sm">Milestone markets on creators appear here.</p>
              </div>
            )}
            <div className="absolute -bottom-16 right-6 z-10 hidden rotate-[3deg] sm:block">
              <div className="card flex items-center gap-2 px-3.5 py-2.5 shadow-pop">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-accent-soft text-accent"><FlaskConical size={15} /></span>
                <div className="text-xs">
                  <p className="font-semibold">Trial post: hook B wins</p>
                  <p className="text-muted">Shown to non-followers first</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- stats strip */}
      <section className="border-y border-line bg-panel">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-y-6 px-5 py-8 md:grid-cols-4">
          {STATS.map((s) => (
            <div key={s.label} className="text-center">
              <p className="font-display text-3xl font-extrabold tracking-tight text-accent">{s.value}</p>
              <p className="mt-1 text-sm text-muted">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------------------------------------------------- features */}
      <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20">
        <SectionHead kicker="Why Monsoc" title="Everything a platform takes from you, back in your hands." />
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="card p-6 transition hover:-translate-y-0.5 hover:shadow-pop">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
                <f.icon size={20} />
              </span>
              <h3 className="mt-4 font-display text-lg font-bold">{f.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------------------------------------------------- how it works */}
      <section id="how" className="scroll-mt-20 border-y border-line bg-panel-2/60">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <SectionHead kicker="How it works" title="From passkey to your first backed creator in a minute." />
          <ol className="mt-10 grid gap-4 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="card relative p-6">
                <span className="absolute right-5 top-4 font-display text-5xl font-extrabold text-line">{i + 1}</span>
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-on-accent">
                  <s.icon size={20} />
                </span>
                <h3 className="mt-4 font-display text-lg font-bold">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ---------------------------------------------------------- markets explainer */}
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-5 py-20 lg:grid-cols-2">
        <div>
          <SectionHead kicker="Milestone markets" title="Call it before the crowd does." align="left" />
          <p className="mt-4 text-muted">
            &ldquo;Will @nova hit 1,000 followers by Friday?&rdquo; Back YES or NO. Stakes placed early count up to 2x, and the contract
            settles itself by counting verified followers onchain. No oracle, no admin.
          </p>
          <ul className="mt-6 space-y-2.5 text-sm">
            {[
              "Creators opt in and earn 1% of the losing pool",
              "Only accounts that existed at market open count",
              "Payouts are provably solvent, tested with fuzzing",
            ].map((t) => (
              <li key={t} className="flex items-start gap-2">
                <Check size={16} className="mt-0.5 shrink-0 text-good" /> {t}
              </li>
            ))}
          </ul>
          <Link href="/markets" className="btn-ghost mt-8">
            See live markets <ArrowRight size={15} />
          </Link>
        </div>
        <div className="card p-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Your weight on a stake</p>
          <div className="mt-5 flex h-40 items-end gap-2">
            {[100, 90, 80, 70, 62, 55, 50].map((h, i) => (
              <div key={i} className="flex-1 rounded-t-lg bg-accent" style={{ height: `${h}%`, opacity: 1 - i * 0.1 }} />
            ))}
          </div>
          <div className="mt-3 flex justify-between text-xs text-muted">
            <span>Market opens · 2x</span>
            <span>Deadline · 1x</span>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- final CTA */}
      <section className="mx-auto max-w-6xl px-5 pb-20">
        <div className="rounded-3xl bg-accent px-6 py-14 text-center text-on-accent sm:px-12">
          <h2 className="font-display text-3xl font-extrabold tracking-tight sm:text-5xl">One identity. One graph. A thousand feeds.</h2>
          <p className="mx-auto mt-4 max-w-xl opacity-85">Claim your handle now. It takes one Touch ID, and your followers come with you wherever you go.</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/onboarding" className="btn bg-on-accent px-6 py-3 text-base text-accent hover:opacity-90">
              <Fingerprint size={18} /> Create account
            </Link>
            <Link href="/login" className="btn border border-on-accent/40 px-6 py-3 text-base hover:bg-on-accent/10">
              Log in
            </Link>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- footer */}
      <footer className="border-t border-line bg-panel">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <Link href="/" className="flex items-center gap-2.5">
              <Logo />
              <span className="font-display text-xl font-bold tracking-tight">{cfg.name}</span>
            </Link>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-muted">
              An open social protocol on Monad. Own your identity, your audience and your feed.
            </p>
            <a href={REPO} target="_blank" rel="noreferrer" className="btn-ghost btn-sm mt-5">
              <Code2 size={14} /> GitHub
            </a>
          </div>
          <FooterCol
            title="Product"
            links={[
              ["Explore", "/explore"],
              ["Markets", "/markets"],
              ["Communities", "/communities"],
              ["Scouts", "/scouts"],
            ]}
          />
          <FooterCol
            title="Protocol"
            links={[
              ["Feed marketplace", "/feeds"],
              ["Trial posts", "/trials"],
              ["Search", "/search"],
            ]}
          />
          <FooterCol
            title="Account"
            links={[
              ["Create account", "/onboarding"],
              ["Log in", "/login"],
              ["Source code", REPO],
            ]}
          />
        </div>
        <div className="border-t border-line">
          <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-5 py-5 text-xs text-muted sm:flex-row">
            <span>© {new Date().getFullYear()} {cfg.name}. Open source.</span>
            <span>Built on Monad · Passkeys by Mera</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

function SectionHead({ kicker, title, align = "center" }: { kicker: string; title: string; align?: "center" | "left" }) {
  return (
    <div className={align === "center" ? "mx-auto max-w-2xl text-center" : ""}>
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-accent">{kicker}</p>
      <h2 className="mt-3 font-display text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">{title}</h2>
    </div>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <p className="text-sm font-semibold">{title}</p>
      <ul className="mt-3 space-y-2 text-sm text-muted">
        {links.map(([label, href]) => (
          <li key={label}>
            {href.startsWith("http") ? (
              <a href={href} target="_blank" rel="noreferrer" className="hover:text-text">{label}</a>
            ) : (
              <Link href={href} className="hover:text-text">{label}</Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
