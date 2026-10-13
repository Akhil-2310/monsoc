"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { FeedInfo, Profile } from "@monsoc/sdk";
import { Shell, PageHeader } from "@/components/Shell";
import { FeedView } from "@/components/FeedView";
import { Composer } from "@/components/Composer";
import { Avatar } from "@/components/Avatar";
import { useSession, relay } from "@/lib/session";
import { BUILTIN_FEEDS } from "@/lib/feeds";
import { usd } from "@/lib/format";
import cfg from "@/monsoc.config";

const FEED_KEY = "monsoc.feed";

export default function Home() {
  const { fid, ready } = useSession();
  const [feeds, setFeeds] = useState<FeedInfo[] | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    relay
      .feeds()
      .then((fs) => {
        const list = fs.length ? fs.filter((f) => !cfg.defaultFeeds.length || cfg.defaultFeeds.includes(f.id)) : BUILTIN_FEEDS;
        setFeeds(list);
        const saved = Number(localStorage.getItem(FEED_KEY));
        setActive(list.some((f) => f.id === saved) ? saved : list[0]!.id);
      })
      .catch(() => {
        setFeeds(BUILTIN_FEEDS);
        setActive(BUILTIN_FEEDS[0]!.id);
      });
  }, []);

  const pick = (id: number) => {
    setActive(id);
    localStorage.setItem(FEED_KEY, String(id));
  };
  const feed = feeds?.find((f) => f.id === active);

  return (
    <Shell aside={<HomeAside />}>
      <PageHeader title="Home" sub={feed ? `${feed.name}${feed.ownerHandle ? ` · by @${feed.ownerHandle}` : ""} · v${feed.version}` : cfg.tagline} />
      {/* one-tap feed switcher */}
      <div className="flex gap-1.5 overflow-x-auto border-b border-line px-3 py-2">
        {feeds?.map((f) => (
          <button key={f.id} onClick={() => pick(f.id)} className={`tab ${f.id === active ? "tab-on" : ""}`} title={f.description}>
            {f.kind === "hosted" ? "⚡ " : ""}
            {f.name}
            {f.priceUsd > 0 && <span className="ml-1 text-[10px] text-warn">{usd(f.priceUsd)}</span>}
          </button>
        ))}
        <Link href="/feeds" className="tab">+ Browse</Link>
      </div>
      {ready && !fid && (
        <div className="m-4 card flex items-center gap-3 p-4">
          <div className="flex-1 text-sm">
            <b>Own your identity, audience and feed.</b>
            <p className="text-muted">Passkey sign-up, no seed phrase, no gas. Your follows live onchain and go wherever you go.</p>
          </div>
          <Link href="/onboarding" className="btn-primary">Get started</Link>
        </div>
      )}
      <Composer onPosted={() => setReload((r) => r + 1)} />
      {feed && <FeedView feed={feed} reloadKey={reload} />}
    </Shell>
  );
}

function HomeAside() {
  const { fid, following, setFollow } = useSession();
  const [people, setPeople] = useState<Profile[]>([]);
  const [scouts, setScouts] = useState<{ handle: string | null; fid: number; score: number; scoutTier: string | null }[]>([]);

  useEffect(() => {
    relay.scouts().then((s) => setScouts(s.slice(0, 5))).catch(() => undefined);
    relay.onboarding("0x0000000000000000000000000000000000000000").then((o) => setPeople(o.people)).catch(() => undefined);
  }, []);

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <h3 className="mb-3 text-sm font-semibold">Who to follow</h3>
        {people
          .filter((p) => p.fid !== fid && !following.has(p.fid))
          .slice(0, 5)
          .map((p) => (
            <div key={p.fid} className="mb-2 flex items-center gap-2">
              <Avatar fid={p.fid} handle={p.handle} size={32} />
              <Link href={`/u/${p.handle ?? p.fid}`} className="min-w-0 flex-1 text-sm">
                <div className="truncate font-medium">@{p.handle}</div>
                <div className="text-xs text-muted">{p.followers} followers</div>
              </Link>
              {fid && (
                <button className="btn-ghost btn-sm" onClick={() => setFollow(p.fid, true).catch(() => undefined)}>
                  Follow
                </button>
              )}
            </div>
          ))}
      </div>
      {cfg.plugins.scouts && scouts.length > 0 && (
        <div className="card p-4">
          <h3 className="mb-3 text-sm font-semibold">Top scouts</h3>
          {scouts.map((s, i) => (
            <Link key={s.fid} href={`/u/${s.handle ?? s.fid}`} className="mb-2 flex items-center gap-2 text-sm">
              <span className="w-4 text-muted">{i + 1}</span>
              <Avatar fid={s.fid} handle={s.handle} size={24} />
              <span className="flex-1">@{s.handle}</span>
              <span className="chip bg-accent-soft text-accent">{s.scoutTier ?? "Scout"}</span>
            </Link>
          ))}
          <Link href="/scouts" className="text-xs text-accent">See leaderboard →</Link>
        </div>
      )}
      <p className="px-2 text-[11px] leading-relaxed text-muted">
        Feeds are open: rule-based feeds run in your browser from a public JSON definition, hosted feeds return ranked ids. Every feed reserves slots for
        creators you don't follow.
      </p>
    </div>
  );
}
