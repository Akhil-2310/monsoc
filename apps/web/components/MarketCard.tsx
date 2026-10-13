"use client";
import Link from "next/link";
import { useState } from "react";
import type { MarketInfo } from "@monsoc/sdk";
import { Avatar } from "./Avatar";
import { ThumbsDown, ThumbsUp, TrendingUp } from "lucide-react";
import { StakeSheet } from "./StakeSheet";
import { fmtUsd, timeLeft } from "@/lib/markets";
import { useSession } from "@/lib/session";
import { refreshMarkets } from "@/lib/useMarkets";

export const compact = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(n));

/** "tomorrow", "this Friday", "next Tuesday", otherwise "30 Nov". */
export function friendlyDate(ms: number): string {
  const d = new Date(ms);
  const day = (x: Date) => Math.floor(new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime() / 86_400_000);
  const diff = day(d) - day(new Date());
  if (diff <= 0) return "today";
  if (diff === 1) return "tomorrow";
  const weekday = d.toLocaleDateString(undefined, { weekday: "long" });
  if (diff < 7) return `this ${weekday}`;
  if (diff < 14) return `next ${weekday}`;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** The one question a market settles on, generated from its onchain parameters. */
export function marketQuestion(m: MarketInfo) {
  const who = m.creator?.displayName ? `${m.creator.displayName} (@${m.creator.handle})` : m.creator?.handle ? `@${m.creator.handle}` : `fid ${m.creator?.fid}`;
  return `Will ${who} hit ${compact(m.target)} followers by ${friendlyDate(m.deadline)}?`;
}

export function OutcomeChip({ m }: { m: MarketInfo }) {
  if (m.outcome === "open")
    return (
      <span className="chip bg-accent-soft text-accent">
        <span className="relative mr-0.5 flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
        </span>
        Live · {timeLeft(m.deadline)}
      </span>
    );
  if (m.outcome === "yes") return <span className="chip bg-good/12 text-good">✓ Hit the target</span>;
  if (m.outcome === "no") return <span className="chip bg-bad/12 text-bad">✗ Missed the target</span>;
  return <span className="chip bg-panel-2 text-muted">Refunded (no one took the other side)</span>;
}

export function Progress({ m }: { m: MarketInfo }) {
  const pct = Math.min(100, Math.round((m.counted / m.target) * 100));
  return (
    <div>
      <div className="flex justify-between text-xs text-muted">
        <span>
          <b className="text-text">{m.counted}</b> / {m.target} verified followers
        </span>
        <span>{pct}%</span>
      </div>
      <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-panel-2">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundImage: m.outcome === "no" ? "linear-gradient(90deg, var(--bad), var(--coral))" : "linear-gradient(90deg, var(--accent), var(--accent-2))" }}
        />
      </div>
    </div>
  );
}

export function MarketCard({ m, onChanged, inFeed = false }: { m: MarketInfo; onChanged?: () => void; inFeed?: boolean }) {
  const { fid } = useSession();
  const [side, setSide] = useState<"yes" | "no" | null>(null);
  const yes = Math.round(m.yesShare * 100);
  const total = Number(m.yesPool) + Number(m.noPool);
  const isCreator = fid === m.creator?.fid;

  return (
    <div className={inFeed ? "rounded-3xl border border-accent/25 bg-gradient-to-br from-accent-soft via-panel to-panel p-4 shadow-soft" : "card p-4"}>
      {inFeed && (
        <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-accent">
          <TrendingUp size={13} /> Live market
          <span className="font-normal normal-case tracking-normal text-muted">· back creators before they break through</span>
        </div>
      )}
      <div className="flex items-start gap-3">
        <Link href={`/u/${m.creator?.handle ?? m.creator?.fid}`}>
          <Avatar fid={m.creator?.fid ?? 0} handle={m.creator?.handle} src={m.creator?.avatar} size={44} />
        </Link>
        <div className="min-w-0 flex-1">
          <Link href={`/m/${m.id}`} className="block font-display text-[17px] font-bold leading-snug hover:underline">
            {marketQuestion(m)}
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
            <OutcomeChip m={m} />
            <span>{fmtUsd(total)} staked · {m.stakers} {m.stakers === 1 ? "backer" : "backers"}</span>
          </div>
        </div>
      </div>
      <div className="mt-3">
        <Progress m={m} />
      </div>
      <div className="mt-3 flex items-center justify-between text-xs font-semibold">
        <span className="text-good">YES {yes}%</span>
        <span className="text-bad">{100 - yes}% NO</span>
      </div>
      <div className="mt-1 flex h-1.5 gap-0.5 overflow-hidden rounded-full">
        <div className="rounded-full bg-good" style={{ width: `${yes}%` }} />
        <div className="rounded-full bg-bad" style={{ width: `${100 - yes}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-muted">
        <span>{fmtUsd(m.yesPool)} on yes</span>
        <span>{fmtUsd(m.noPool)} on no</span>
      </div>
      {m.outcome === "open" && fid && !isCreator && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button className="btn rounded-2xl bg-good/12 py-2.5 text-good hover:bg-good hover:text-white" onClick={() => setSide("yes")}>
            <ThumbsUp size={15} /> Back YES
          </button>
          <button className="btn rounded-2xl bg-bad/12 py-2.5 text-bad hover:bg-bad hover:text-white" onClick={() => setSide("no")}>
            <ThumbsDown size={15} /> Back NO
          </button>
        </div>
      )}
      {m.outcome === "open" && isCreator && <p className="mt-3 text-xs text-muted">This market is about you, so you can't stake on it. You earn 1% of the losing pool.</p>}
      {side && (
        <StakeSheet
          marketId={m.id}
          side={side}
          onClose={() => setSide(null)}
          onDone={() => {
            setSide(null);
            refreshMarkets();
            onChanged?.();
          }}
        />
      )}
    </div>
  );
}
