"use client";
import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import type { MarketDetail } from "@monsoc/sdk";
import { marketsAbi } from "@monsoc/sdk";
import { Shell, PageHeader } from "@/components/Shell";
import { Avatar } from "@/components/Avatar";
import { MarketCard, marketQuestion } from "@/components/MarketCard";
import { useSession, relay, deployment } from "@/lib/session";
import { fmtUsd } from "@/lib/markets";
import { errMsg, timeAgo } from "@/lib/format";
import cfg from "@/monsoc.config";

const EXPLORER = cfg.chainId === 10143 ? "https://testnet.monadexplorer.com" : null;

export default function MarketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { fid, call } = useSession();
  const [m, setM] = useState<MarketDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => relay.market(Number(id), fid ?? undefined).then(setM, (e) => setErr(errMsg(e))), [id, fid]);
  useEffect(() => {
    load();
    const t = setInterval(load, 8_000);
    return () => clearInterval(t);
  }, [load]);

  const claim = async () => {
    if (!fid) return;
    setBusy(true);
    setErr(null);
    try {
      await call(deployment.markets!, marketsAbi, "claim", [BigInt(id), BigInt(fid)]);
      setTimeout(load, 1500);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  if (!m) return <Shell><PageHeader title="Market" /><p className="p-6 text-sm text-muted">{err ?? "Loading…"}</p></Shell>;
  const p = m.position;
  const hasPos = p && (p.yesStake !== "0" || p.noStake !== "0");

  return (
    <Shell>
      <PageHeader title={`Market #${m.id}`} sub={marketQuestion(m)} />
      <div className="p-4">
        <MarketCard m={m} onChanged={load} />
      </div>

      {hasPos && (
        <section className="mx-4 card p-4">
          <h3 className="font-semibold">Your position</h3>
          <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-xl bg-good/10 p-2">
              YES <b>{fmtUsd(p!.yesStake)}</b>
              {p!.yesStake !== "0" && <span className="text-xs text-muted"> · {(Number(p!.yesWeight) / Number(p!.yesStake)).toFixed(2)}x</span>}
            </div>
            <div className="rounded-xl bg-bad/10 p-2">
              NO <b>{fmtUsd(p!.noStake)}</b>
              {p!.noStake !== "0" && <span className="text-xs text-muted"> · {(Number(p!.noWeight) / Number(p!.noStake)).toFixed(2)}x</span>}
            </div>
          </div>
          {m.outcome !== "open" &&
            (p!.claimed ? (
              <p className="mt-3 text-sm text-good">✓ Claimed</p>
            ) : p!.payout !== "0" ? (
              <button className="btn-primary mt-3 w-full" disabled={busy} onClick={claim}>
                {busy ? "Claiming…" : `Claim ${fmtUsd(p!.payout)}`}
              </button>
            ) : (
              <p className="mt-3 text-sm text-muted">This one didn't go your way.</p>
            ))}
          {err && <p className="mt-2 text-xs text-bad">{err}</p>}
        </section>
      )}

      <section className="m-4 card p-4">
        <h3 className="font-semibold">Backers</h3>
        {m.stakes.length === 0 && <p className="mt-2 text-sm text-muted">No one yet. The first backers get the biggest early bonus.</p>}
        <div className="mt-2 divide-y divide-line">
          {m.stakes.map((s, i) => (
            <div key={i} className="flex items-center gap-2 py-2 text-sm">
              <Avatar fid={s.fid} handle={s.handle} size={24} />
              <Link href={`/u/${s.handle ?? s.fid}`} className="flex-1 hover:underline">@{s.handle ?? s.fid}</Link>
              <span className={s.yes ? "text-good" : "text-bad"}>{s.yes ? "YES" : "NO"} {fmtUsd(s.amount)}</span>
              <span className="w-12 text-right text-xs text-accent">{(Number(s.weight) / Number(s.amount)).toFixed(2)}x</span>
              <span className="w-10 text-right text-xs text-muted">{timeAgo(s.at)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="m-4 rounded-xl border border-line p-4 text-xs text-muted">
        <p className="font-semibold text-text">Verifiable settlement</p>
        <p className="mt-1">
          {m.counted} follower{m.counted === 1 ? "" : "s"} counted onchain, each checked against the FollowGraph contract. Only accounts with fid ≤ {m.maxFid}{" "}
          (accounts that existed when this market opened) count. Anyone can submit counts or settle; this relay just does it automatically.
        </p>
        {EXPLORER && deployment.markets && (
          <a className="mt-2 inline-block text-accent hover:underline" href={`${EXPLORER}/address/${deployment.markets}`} target="_blank" rel="noreferrer">
            View CreatorMarkets contract →
          </a>
        )}
      </section>
    </Shell>
  );
}
