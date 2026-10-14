"use client";
import { useEffect, useState } from "react";
import type { MarketDetail } from "@monsoc/sdk";
import { useSession, relay } from "@/lib/session";
import { estimatePayout, placeStake } from "@/lib/markets";
import { errMsg } from "@/lib/format";
import { marketQuestion } from "./MarketCard";

const PRESETS = [1, 5, 10, 25];

export function StakeSheet({ marketId, side, onClose, onDone }: { marketId: number; side: "yes" | "no"; onClose: () => void; onDone: () => void }) {
  const { fid, appKey, call, send } = useSession();
  const [staked, setStaked] = useState<number | null>(null);
  const [shareText, setShareText] = useState("");
  const [sharing, setSharing] = useState(false);
  const [m, setM] = useState<MarketDetail | null>(null);
  const [amount, setAmount] = useState("5");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ack, setAck] = useState(false);

  useEffect(() => {
    relay.market(marketId, fid ?? undefined).then(setM, (e) => setErr(errMsg(e)));
  }, [marketId, fid]);

  const n = Number(amount);
  const valid = Number.isFinite(n) && n >= 1 && n <= 100;
  const win = m && valid ? estimatePayout(m, side, n, m.multiplier) : 0;

  const submit = async () => {
    if (!fid || !appKey || !m) return;
    setBusy(true);
    setErr(null);
    try {
      await placeStake(call, appKey.address, fid, marketId, side === "yes", n);
      setStaked(n);
      setShareText(
        side === "yes"
          ? `Backing @${m.creator?.handle} to hit ${m.target} followers. Get in early 👀`
          : `Calling it: @${m.creator?.handle} won't hit ${m.target} followers in time.`,
      );
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    setSharing(true);
    setErr(null);
    try {
      await send("post", { text: shareText.trim(), market: marketId });
      onDone();
    } catch (e) {
      setErr(errMsg(e));
      setSharing(false);
    }
  };

  // after staking: offer to post the bet (with the market attached) so followers can join in
  if (staked !== null)
    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center" onClick={onDone}>
        <div className="card w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
          <h3 className="text-lg font-bold text-good">✓ You backed {side.toUpperCase()} with ${staked}</h3>
          <p className="mt-1 text-sm text-muted">Share your bet? Your followers see it with the market attached and can back it too.</p>
          <textarea className="input mt-3" rows={3} maxLength={280} value={shareText} onChange={(e) => setShareText(e.target.value)} />
          {err && <p className="mt-2 text-xs text-bad">{err}</p>}
          <div className="mt-3 flex gap-2">
            <button className="btn-ghost flex-1" onClick={onDone}>Not now</button>
            <button className="btn-primary flex-1" disabled={sharing || !shareText.trim()} onClick={share}>
              {sharing ? "Posting…" : "Share your bet"}
            </button>
          </div>
        </div>
      </div>
    );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center" onClick={onClose}>
      <div className="card w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className={`text-lg font-bold ${side === "yes" ? "text-good" : "text-bad"}`}>Back {side.toUpperCase()}</h3>
          <button className="text-muted hover:text-text" onClick={onClose}>✕</button>
        </div>
        {m && <p className="mt-1 text-sm text-muted">{marketQuestion(m)}</p>}

        <div className="mt-4 flex gap-2">
          {PRESETS.map((p) => (
            <button key={p} className={`btn-ghost btn-sm flex-1 ${Number(amount) === p ? "border-accent text-accent" : ""}`} onClick={() => setAmount(String(p))}>
              ${p}
            </button>
          ))}
        </div>
        <label className="field mt-2">
          <span className="text-muted">$</span>
          <input className="flex-1 bg-transparent px-1 py-2 text-sm outline-none" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <span className="text-xs text-muted">tUSD</span>
        </label>

        {m && (
          <div className="mt-3 space-y-1 rounded-xl bg-panel-2 p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted">Early bonus right now</span>
              <b className="text-accent">{m.multiplier.toFixed(2)}x weight</b>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">If {side.toUpperCase()} wins, you get about</span>
              <b>${win.toFixed(2)}</b>
            </div>
            <p className="pt-1 text-[11px] text-muted">
              Winners get their stake back plus a share of the other side, weighted by how early they backed. The estimate changes as others stake.
              Settled onchain from the follow graph: no oracle, no admin.
            </p>
          </div>
        )}

        <label className="mt-3 flex items-start gap-2 text-[11px] text-muted">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" />
          I understand I can lose this stake. This testnet uses play money (tUSD); real-money markets would be limited by country and age.
        </label>
        {err && <p className="mt-2 text-xs text-bad">{err}</p>}
        <button
          className={`btn mt-3 w-full rounded-xl py-2.5 font-semibold text-on-accent ${side === "yes" ? "bg-good/90 hover:bg-good" : "bg-bad/90 hover:bg-bad"}`}
          disabled={!valid || !ack || busy || !m}
          onClick={submit}
        >
          {busy ? "Staking…" : `Stake $${valid ? n : "…"} on ${side.toUpperCase()}`}
        </button>
        {!valid && <p className="mt-1 text-center text-[11px] text-muted">Stake between $1 and $100.</p>}
      </div>
    </div>
  );
}
