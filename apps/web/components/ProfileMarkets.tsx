"use client";
import { TrendingUp } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { MarketInfo, Profile } from "@monsoc/sdk";
import { marketsAbi } from "@monsoc/sdk";
import { useSession, relay, deployment } from "@/lib/session";
import { fmtUsd } from "@/lib/markets";
import { errMsg } from "@/lib/format";
import { MarketCard } from "./MarketCard";
import { CreateMarketSheet } from "./CreateMarketSheet";
import cfg from "@/monsoc.config";

/** Milestone markets on a creator: consent switch + fees (own profile), or "open a market" (others). */
export function ProfileMarkets({ p }: { p: Profile }) {
  const { fid, call } = useSession();
  const [info, setInfo] = useState<{ enabled: boolean; optedIn: boolean; creatorFees: string } | null>(null);
  const [list, setList] = useState<MarketInfo[]>([]);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isMe = fid === p.fid;

  const load = useCallback(() => {
    relay.marketInfo(p.fid).then(setInfo, () => undefined);
    relay.markets({ creator: p.fid }).then(setList, () => undefined);
  }, [p.fid]);
  useEffect(load, [load]);

  if (!cfg.plugins.markets || !info?.enabled) return null;

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      setTimeout(load, 1500);
    } catch (e) {
      setErr(`${label}: ${errMsg(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="border-b border-line p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-2 font-display font-bold"><TrendingUp size={17} className="text-accent" /> Milestone markets</h3>
        {isMe ? (
          <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={info.optedIn}
              disabled={busy}
              onChange={(e) => act("Update", () => call(deployment.markets!, marketsAbi, "setOptIn", [BigInt(p.fid), e.target.checked]))}
            />
            Allow markets on me
          </label>
        ) : (
          fid &&
          info.optedIn && (
            <button className="btn-primary btn-sm ml-auto" onClick={() => setCreating(true)}>
              + Open a market
            </button>
          )
        )}
      </div>
      <p className="mt-1 text-xs text-muted">
        {isMe
          ? info.optedIn
            ? "Fans can bet on your follower milestones. You earn 1% of every losing pool, and you can't bet on yourself."
            : "Let fans back you on follower milestones and earn 1% of every losing pool. You can switch this off any time."
          : info.optedIn
            ? `Bet on @${p.handle}'s follower milestones. Early backers earn up to 2x weight.`
            : `@${p.handle} hasn't enabled markets.`}
      </p>
      {isMe && info.creatorFees !== "0" && (
        <div className="mt-2 flex items-center gap-2 rounded-xl bg-panel-2 px-3 py-2 text-sm">
          <span className="flex-1">Creator fees earned: <b>{fmtUsd(info.creatorFees)}</b></span>
          <button className="btn-ghost btn-sm" disabled={busy} onClick={() => act("Withdraw", () => call(deployment.markets!, marketsAbi, "withdrawCreatorFees", [BigInt(p.fid)]))}>
            Withdraw
          </button>
        </div>
      )}
      {err && <p className="mt-2 text-xs text-bad">{err}</p>}
      {list.length > 0 && (
        <div className="mt-3 grid gap-3">
          {list.slice(0, 3).map((m) => <MarketCard key={m.id} m={m} onChanged={load} />)}
        </div>
      )}
      {creating && <CreateMarketSheet creatorFid={p.fid} handle={p.handle ?? String(p.fid)} followers={p.followers} onClose={() => setCreating(false)} />}
    </section>
  );
}
