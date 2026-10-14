"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { MarketInfo } from "@monsoc/sdk";
import { Shell, PageHeader } from "@/components/Shell";
import { MarketCard } from "@/components/MarketCard";
import { NewMarketPicker } from "@/components/NewMarket";
import { useSession, relay } from "@/lib/session";
import { errMsg } from "@/lib/format";

const TABS = [
  { id: "open", label: "Live" },
  { id: "resolved", label: "Settled" },
  { id: "mine", label: "My bets" },
] as const;

export default function Markets() {
  const { fid, profile } = useSession();
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("open");
  const [list, setList] = useState<MarketInfo[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  const load = useCallback(() => {
    const q = tab === "mine" ? { fid: fid ?? -1 } : { status: tab };
    relay.markets(q).then(setList, (e) => setErr(errMsg(e)));
  }, [tab, fid]);
  useEffect(() => {
    setList(null);
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <Shell aside={<HowItWorks />}>
      <PageHeader
        title="Markets"
        sub="Back creators before they break through. Settled by the onchain follow graph."
        right={
          fid && (
            <button className="btn-primary btn-sm" onClick={() => setPicking(true)}>
              + New market
            </button>
          )
        }
      />
      {picking && <NewMarketPicker onClose={() => setPicking(false)} />}
      <div className="flex gap-1 border-b border-line px-3 py-2">
        {TABS.filter((t) => t.id !== "mine" || fid).map((t) => (
          <button key={t.id} className={`tab ${tab === t.id ? "tab-on" : ""}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {err && <p className="p-4 text-sm text-bad">{err}</p>}
      {list?.length === 0 && (
        <div className="p-8 text-center text-sm text-muted">
          {tab === "open" ? (
            <>
              No live markets yet. Tap + New market, or open one from a creator's profile
              {profile?.handle && (
                <>
                  , or{" "}
                  <Link href={`/u/${profile.handle}`} className="text-accent">allow markets on yourself</Link>
                </>
              )}
              .
            </>
          ) : tab === "mine" ? (
            "You haven't backed anyone yet."
          ) : (
            "Nothing settled yet."
          )}
        </div>
      )}
      <div className="grid gap-3 p-4">
        {list?.map((m) => <MarketCard key={m.id} m={m} onChanged={load} />)}
      </div>
      <div className="p-4 lg:hidden">
        <HowItWorks />
      </div>
    </Shell>
  );
}

function HowItWorks() {
  return (
    <div className="card space-y-2 p-4 text-sm">
      <h3 className="font-semibold">How it works</h3>
      <p className="text-muted"><b className="text-text">1. Creators opt in.</b> No one can bet on you without your consent, and you can't bet on yourself.</p>
      <p className="text-muted"><b className="text-text">2. Back YES or NO</b> on a follower milestone. Backing early earns up to <b className="text-accent">2x weight</b>, falling to 1x at the deadline.</p>
      <p className="text-muted"><b className="text-text">3. Settled by the graph.</b> The contract checks every follow onchain. YES pays out the moment the target is hit; NO at the deadline. No oracle, no admin.</p>
      <p className="text-muted"><b className="text-text">4. Winners</b> get their stake back plus the losing pool, split by weight. Creators earn 1% of it.</p>
      <p className="text-[11px] text-muted">Only accounts that existed when a market opened count, so fake accounts can't swing it. Testnet play money (tUSD).</p>
    </div>
  );
}
