"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { FeedInfo, Profile } from "@monsoc/sdk";
import { Shell, PageHeader } from "@/components/Shell";
import { FeedView } from "@/components/FeedView";
import { Composer } from "@/components/Composer";
import { Avatar } from "@/components/Avatar";
import { Check, ChevronDown, Gem, Plus, SlidersHorizontal, TrendingUp, UserPlus, Zap } from "lucide-react";
import { useRef } from "react";
import { useSession, relay } from "@/lib/session";
import { BUILTIN_FEEDS, isTopicFeed, STYLE_KEY, TOPIC_KEY } from "@/lib/feeds";
import { usd } from "@/lib/format";
import { useLiveMarkets } from "@/lib/useMarkets";
import { timeLeft } from "@/lib/markets";
import cfg from "@/monsoc.config";

/** The main feed: "For you" (ranked by your chosen style) plus topic feeds. Guests see it read-only at /explore. */
export function HomeFeed() {
  const { fid } = useSession();
  const [feeds, setFeeds] = useState<FeedInfo[] | null>(null);
  const [styleId, setStyleId] = useState<number | null>(null); // ranking behind "For you"
  const [topicId, setTopicId] = useState<number | null>(null); // null = "For you"
  const [reload, setReload] = useState(0);

  useEffect(() => {
    relay
      .feeds()
      .then((fs) => (fs.length ? fs.filter((f) => !cfg.defaultFeeds.length || cfg.defaultFeeds.includes(f.id)) : BUILTIN_FEEDS))
      .catch(() => BUILTIN_FEEDS)
      .then((list) => {
        setFeeds(list);
        const styles = list.filter((f) => !isTopicFeed(f));
        const savedStyle = Number(localStorage.getItem(STYLE_KEY));
        setStyleId(styles.some((f) => f.id === savedStyle) ? savedStyle : (styles[0]?.id ?? null));
        const savedTopic = Number(localStorage.getItem(TOPIC_KEY));
        setTopicId(list.some((f) => f.id === savedTopic && isTopicFeed(f)) ? savedTopic : null);
      });
  }, []);

  const topics = feeds?.filter(isTopicFeed) ?? [];
  const styles = feeds?.filter((f) => !isTopicFeed(f)) ?? [];
  const style = styles.find((f) => f.id === styleId);
  const feed = topicId ? topics.find((f) => f.id === topicId) : style;

  const pickTopic = (id: number | null) => {
    setTopicId(id);
    id ? localStorage.setItem(TOPIC_KEY, String(id)) : localStorage.removeItem(TOPIC_KEY);
  };
  const pickStyle = (id: number) => {
    setStyleId(id);
    localStorage.setItem(STYLE_KEY, String(id));
    pickTopic(null);
  };

  return (
    <Shell aside={<HomeAside />}>
      <PageHeader
        title={fid ? "Home" : "Explore"}
        sub={feed ? (topicId ? `${feed.name} · ${feed.description}` : `For you · ranked by ${style?.name ?? "default"}`) : cfg.tagline}
        right={styles.length > 1 && <RankingMenu styles={styles} value={styleId} onChange={pickStyle} />}
      />
      {/* "For you" + topic feeds; ranking styles live in the menu above (and in communities) */}
      <div className="flex gap-1.5 overflow-x-auto border-b border-line px-4 py-2.5 [scrollbar-width:none]">
        <button onClick={() => pickTopic(null)} className={`tab ${topicId === null ? "tab-on" : ""}`}>
          For you
        </button>
        {topics.map((f) => (
          <button key={f.id} onClick={() => pickTopic(f.id)} className={`tab ${f.id === topicId ? "tab-on" : ""}`} title={f.description}>
            {f.name}
            {f.priceUsd > 0 && <span className="ml-1 text-[10px] text-warn">{usd(f.priceUsd)}</span>}
          </button>
        ))}
        <Link href="/feeds" className="tab flex items-center gap-1"><Plus size={14} /> Browse</Link>
      </div>
      <Composer onPosted={() => setReload((r) => r + 1)} />
      {feed && <FeedView feed={feed} reloadKey={reload} showMarkets />}
    </Shell>
  );
}

function HomeAside() {
  const { fid, following, setFollow } = useSession();
  const markets = useLiveMarkets();
  const [people, setPeople] = useState<Profile[]>([]);
  const [scouts, setScouts] = useState<{ handle: string | null; fid: number; score: number; scoutTier: string | null }[]>([]);

  useEffect(() => {
    relay.scouts().then((s) => setScouts(s.slice(0, 5))).catch(() => undefined);
    relay.onboarding("0x0000000000000000000000000000000000000000").then((o) => setPeople(o.people)).catch(() => undefined);
  }, []);

  return (
    <div className="space-y-4">
      {cfg.plugins.markets && markets.length > 0 && (
        <div className="card p-4">
          <h3 className="mb-3 flex items-center gap-2 font-display font-bold"><TrendingUp size={17} className="text-accent" /> Live markets</h3>
          {markets.slice(0, 3).map((m) => (
            <Link key={m.id} href={`/m/${m.id}`} className="mb-3 flex items-center gap-2 text-sm">
              <Avatar fid={m.creator?.fid ?? 0} handle={m.creator?.handle} src={m.creator?.avatar} size={28} />
              <div className="min-w-0 flex-1">
                <div className="truncate">
                  @{m.creator?.handle} → <b>{m.target}</b> followers
                </div>
                <div className="text-xs text-muted">
                  {m.counted}/{m.target} · {timeLeft(m.deadline)}
                </div>
              </div>
              <span className="chip bg-good/15 text-good">YES {Math.round(m.yesShare * 100)}%</span>
            </Link>
          ))}
          <Link href="/markets" className="text-xs font-semibold text-accent hover:underline">All markets →</Link>
        </div>
      )}
      {people.some((p) => p.fid !== fid && !following.has(p.fid)) && (
      <div className="card p-4">
        <h3 className="mb-3 flex items-center gap-2 font-display font-bold"><UserPlus size={17} className="text-accent" /> Who to follow</h3>
        {people
          .filter((p) => p.fid !== fid && !following.has(p.fid))
          .slice(0, 5)
          .map((p) => (
            <div key={p.fid} className="mb-2 flex items-center gap-2">
              <Avatar fid={p.fid} handle={p.handle} src={p.avatar} size={32} />
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
      )}
      {cfg.plugins.scouts && scouts.length > 0 && (
        <div className="card p-4">
          <h3 className="mb-3 flex items-center gap-2 font-display font-bold"><Gem size={17} className="text-accent" /> Top scouts</h3>
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

/** Pick the ranking style that powers "For you". */
function RankingMenu({ styles, value, onChange }: { styles: FeedInfo[]; value: number | null; onChange: (id: number) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const current = styles.find((f) => f.id === value);
  return (
    <div ref={ref} className="relative">
      <button className="btn-ghost btn-sm gap-1" onClick={() => setOpen(!open)} title="How 'For you' is ranked">
        <SlidersHorizontal size={13} />
        <span className="hidden sm:inline">{current?.name ?? "Ranking"}</span>
        <ChevronDown size={13} />
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-30 w-72 animate-pop overflow-hidden rounded-2xl border border-line bg-panel p-1 shadow-pop">
          <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Rank “For you” by</p>
          {styles.map((f) => (
            <button
              key={f.id}
              onClick={() => {
                onChange(f.id);
                setOpen(false);
              }}
              className="flex w-full items-start gap-2 rounded-xl px-3 py-2 text-left hover:bg-panel-2"
            >
              <span className="mt-0.5 w-4 text-accent">{f.id === value && <Check size={15} />}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1 text-sm font-semibold">
                  {f.kind === "hosted" && <Zap size={12} className="text-accent" />}
                  {f.name}
                  {f.priceUsd > 0 && <span className="text-[10px] text-warn">{usd(f.priceUsd)}</span>}
                </span>
                <span className="line-clamp-2 text-xs text-muted">{f.description}</span>
              </span>
            </button>
          ))}
          <Link href="/feeds" className="mt-1 block border-t border-line px-3 py-2 text-xs font-semibold text-accent hover:underline">
            Browse or publish feeds →
          </Link>
        </div>
      )}
    </div>
  );
}
