"use client";
import Link from "next/link";
import { useState } from "react";
import type { MarketInfo } from "@monsoc/sdk";
import { Avatar } from "./Avatar";
import { StakeSheet } from "./StakeSheet";
import { fmtUsd, timeLeft } from "@/lib/markets";
import { useSession } from "@/lib/session";

export function marketQuestion(m: MarketInfo) {
  const who = m.creator?.handle ? `@${m.creator.handle}` : `fid ${m.creator?.fid}`;
  const by = new Date(m.deadline).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return `Will ${who} reach ${m.target.toLocaleString()} followers by ${by}?`;
}

export function OutcomeChip({ m }: { m: MarketInfo }) {
  if (m.outcome === "open") return <span className="chip bg-accent-soft text-accent">● live · {timeLeft(m.deadline)}</span>;
  if (m.outcome === "yes") return <span className="chip bg-good/15 text-good">✓ Hit the target</span>;
  if (m.outcome === "no") return <span className="chip bg-bad/15 text-bad">✗ Missed the target</span>;
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
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-panel-2">
        <div className={`h-full rounded-full ${m.outcome === "no" ? "bg-bad" : "bg-good"}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function MarketCard({ m, onChanged }: { m: MarketInfo; onChanged?: () => void }) {
  const { fid } = useSession();
  const [side, setSide] = useState<"yes" | "no" | null>(null);
  const yes = Math.round(m.yesShare * 100);
  const total = Number(m.yesPool) + Number(m.noPool);
  const isCreator = fid === m.creator?.fid;

  return (
    <div className="card p-4">
      <div className="flex items-start gap-3">
        <Link href={`/u/${m.creator?.handle ?? m.creator?.fid}`}>
          <Avatar fid={m.creator?.fid ?? 0} handle={m.creator?.handle} src={m.creator?.avatar} size={44} />
        </Link>
        <div className="min-w-0 flex-1">
          <Link href={`/m/${m.id}`} className="block font-semibold leading-snug hover:underline">
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
      <div className="mt-3 flex h-2 overflow-hidden rounded-full">
        <div className="bg-good/80" style={{ width: `${yes}%` }} />
        <div className="bg-bad/70" style={{ width: `${100 - yes}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-xs">
        <span className="text-good">YES {yes}% · {fmtUsd(m.yesPool)}</span>
        <span className="text-bad">NO {100 - yes}% · {fmtUsd(m.noPool)}</span>
      </div>
      {m.outcome === "open" && fid && !isCreator && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button className="btn rounded-xl bg-good/15 py-2 text-good hover:bg-good/25" onClick={() => setSide("yes")}>Back YES</button>
          <button className="btn rounded-xl bg-bad/15 py-2 text-bad hover:bg-bad/25" onClick={() => setSide("no")}>Back NO</button>
        </div>
      )}
      {m.outcome === "open" && isCreator && <p className="mt-3 text-xs text-muted">This market is about you, so you can't stake on it. You earn 1% of the losing pool.</p>}
      {side && <StakeSheet marketId={m.id} side={side} onClose={() => setSide(null)} onDone={() => (setSide(null), onChanged?.())} />}
    </div>
  );
}
