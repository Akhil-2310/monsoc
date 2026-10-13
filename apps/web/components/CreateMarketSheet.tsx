"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { decodeEventLog } from "viem";
import { marketsAbi } from "@monsoc/sdk";
import { useSession, deployment, publicClient } from "@/lib/session";
import { errMsg } from "@/lib/format";

const DURATIONS = [
  { label: "24 hours", s: 86_400 },
  { label: "7 days", s: 7 * 86_400 },
  { label: "30 days", s: 30 * 86_400 },
  { label: "90 days", s: 90 * 86_400 },
];

/** Open a milestone market on a creator who has opted in. */
export function CreateMarketSheet({ creatorFid, handle, followers, onClose }: { creatorFid: number; handle: string; followers: number; onClose: () => void }) {
  const { fid, call } = useSession();
  const router = useRouter();
  // small creators need small, reachable milestones; bigger ones scale
  const presets = [...new Set([followers + 1, followers + 5, Math.max(followers * 2, followers + 10), followers + 100])].sort((a, b) => a - b);
  const [target, setTarget] = useState(String(presets[1]));
  const [duration, setDuration] = useState(DURATIONS[1]!.s);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const t = Number(target);
  const valid = Number.isInteger(t) && t > followers;

  const create = async () => {
    if (!fid) return;
    setBusy(true);
    setErr(null);
    try {
      const deadline = BigInt(Math.floor(Date.now() / 1000) + duration);
      const txHash = await call(deployment.markets!, marketsAbi, "createMarket", [BigInt(fid), BigInt(creatorFid), BigInt(t), deadline]);
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      for (const log of receipt.logs) {
        try {
          const ev = decodeEventLog({ abi: marketsAbi, data: log.data, topics: log.topics });
          if (ev.eventName === "MarketCreated") return router.push(`/m/${ev.args.marketId}`);
        } catch {}
      }
      onClose();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center" onClick={onClose}>
      <div className="card w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold">Open a market on @{handle}</h3>
          <button className="text-muted hover:text-text" onClick={onClose}>✕</button>
        </div>
        <p className="mt-1 text-sm text-muted">@{handle} has {followers} followers now. Pick a milestone people can bet on.</p>

        <p className="mt-4 text-xs text-muted">Follower target</p>
        <div className="mt-1 flex gap-2">
          {presets.map((p) => (
            <button key={p} className={`btn-ghost btn-sm flex-1 ${t === p ? "border-accent text-accent" : ""}`} onClick={() => setTarget(String(p))}>
              {p}
            </button>
          ))}
        </div>
        <input className="input mt-2" inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value.replace(/\D/g, ""))} />

        <p className="mt-4 text-xs text-muted">Deadline</p>
        <div className="mt-1 grid grid-cols-4 gap-2">
          {DURATIONS.map((d) => (
            <button key={d.s} className={`btn-ghost btn-sm ${duration === d.s ? "border-accent text-accent" : ""}`} onClick={() => setDuration(d.s)}>
              {d.label}
            </button>
          ))}
        </div>

        <div className="mt-4 rounded-xl bg-panel-2 p-3 text-sm">
          “Will @{handle} reach <b>{valid ? t : "…"}</b> followers by{" "}
          <b>{new Date(Date.now() + duration * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</b>?”
          <p className="mt-1 text-[11px] text-muted">
            Only accounts that exist right now count toward the target, so new fake accounts can't swing it. Settles automatically from the onchain
            follow graph.
          </p>
        </div>
        {err && <p className="mt-2 text-xs text-bad">{err}</p>}
        <button className="btn-primary mt-3 w-full py-2.5" disabled={!valid || busy} onClick={create}>
          {busy ? "Opening…" : "Open market"}
        </button>
      </div>
    </div>
  );
}
