"use client";
import Link from "next/link";
import { ArrowRight, FlaskConical, Fingerprint, Gem, LayoutGrid, ShieldCheck, TrendingUp, Users } from "lucide-react";
import { Logo } from "./Shell";
import { MarketCard } from "./MarketCard";
import { useLiveMarkets } from "@/lib/useMarkets";
import cfg from "@/monsoc.config";

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
];

/** What signed-out visitors see at "/". The feed itself stays browsable at /explore. */
export function Landing() {
  const markets = useLiveMarkets();
  const featured = [...markets].sort((a, b) => Number(b.yesPool) + Number(b.noPool) - (Number(a.yesPool) + Number(a.noPool)))[0];

  return (
    <div className="min-h-screen">
      {/* ---------------------------------------------------------- top bar */}
      <header className="mx-auto flex max-w-6xl items-center gap-3 px-5 py-5">
        <Link href="/" className="flex items-center gap-2.5">
          <Logo />
          <span className="font-display text-xl font-bold tracking-tight">{cfg.name}</span>
        </Link>
        <nav className="ml-auto flex items-center gap-1">
          <Link href="/explore" className="tab hidden sm:inline-flex">Explore</Link>
          <Link href="/markets" className="tab hidden sm:inline-flex">Markets</Link>
          <Link href="/login" className="btn-ghost ml-1">Log in</Link>
        </nav>
      </header>

      {/* ---------------------------------------------------------- hero */}
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-5 pb-16 pt-6 md:pt-14 lg:grid-cols-[1.1fr_0.9fr]">
        <div>
          <span className="chip border border-line bg-panel text-muted shadow-soft">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-good opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-good" />
            </span>
            Live on Monad testnet
          </span>
          <h1 className="mt-5 font-display text-[44px] font-extrabold leading-[1.02] tracking-tight sm:text-6xl">
            Social where reach is <span className="gradient-text">earned</span>, and early fans <span className="gradient-text">get paid</span>.
          </h1>
          <p className="mt-5 max-w-xl text-lg text-muted">
            Own your identity, your audience and your feed. No platform decides who gets seen, and the people who spot talent early share in its
            success.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/onboarding" className="btn-primary px-6 py-3 text-base">
              <Fingerprint size={18} /> Create account with passkey
            </Link>
            <Link href="/login" className="btn-ghost px-6 py-3 text-base">
              Log in
            </Link>
          </div>
          <Link href="/explore" className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline">
            Or explore without an account <ArrowRight size={15} />
          </Link>
          <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
            <span className="flex items-center gap-1.5"><ShieldCheck size={15} className="text-good" /> No seed phrase, no gas</span>
            <span className="flex items-center gap-1.5"><Gem size={15} className="text-accent" /> Followers stored onchain</span>
          </div>
        </div>

        {/* a real live market, not a mockup */}
        <div className="relative">
          <div
            className="absolute -inset-6 -z-10 rounded-[40px] opacity-60 blur-3xl"
            style={{ backgroundImage: "radial-gradient(closest-side, var(--accent), transparent), radial-gradient(closest-side at 80% 70%, var(--accent-2), transparent)" }}
          />
          {featured ? (
            <div className="rotate-[-1.5deg] transition hover:rotate-0">
              <MarketCard m={featured} inFeed />
            </div>
          ) : (
            <div className="card p-6 text-center text-muted">
              <TrendingUp className="mx-auto text-accent" />
              <p className="mt-2 text-sm">Milestone markets on creators appear here.</p>
            </div>
          )}
          <p className="mt-4 text-center text-xs text-muted">↑ A live market right now. Back it after you sign up.</p>
        </div>
      </section>

      {/* ---------------------------------------------------------- features */}
      <section className="mx-auto max-w-6xl px-5 pb-20">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="card p-5 transition hover:-translate-y-0.5 hover:shadow-pop">
              <span
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-white"
                style={{ backgroundImage: "linear-gradient(135deg, var(--accent), var(--accent-2))" }}
              >
                <f.icon size={20} />
              </span>
              <h3 className="mt-4 font-display text-lg font-bold">{f.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-line py-8 text-center text-xs text-muted">
        An open social protocol on Monad · passkeys by Mera · <Link href="/explore" className="hover:text-text">Explore</Link> ·{" "}
        <Link href="/feeds" className="hover:text-text">Feed marketplace</Link>
      </footer>
    </div>
  );
}
