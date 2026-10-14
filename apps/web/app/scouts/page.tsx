"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { scoutsAbi } from "@monsoc/sdk";
import { Shell, PageHeader } from "@/components/Shell";
import { Avatar } from "@/components/Avatar";
import { relay, publicClient, deployment, useSession } from "@/lib/session";
import { timeAgo, pct } from "@/lib/format";
import { Gem, TrendingUp } from "lucide-react";

type Row = Awaited<ReturnType<typeof relay.scouts>>[number];
const TOPICS = ["", "ai", "monad", "defi", "cricket"];

export default function Scouts() {
  const [topic, setTopic] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [root, setRoot] = useState<{ root: string; count: bigint } | null>(null);

  useEffect(() => {
    setRows(null);
    relay.scouts(topic || undefined).then(setRows);
  }, [topic]);
  useEffect(() => {
    publicClient
      .readContract({ address: deployment.scouts, abi: scoutsAbi, functionName: "rootCount" })
      .then(async (count) => {
        if (count === 0n) return;
        const [r] = await publicClient.readContract({ address: deployment.scouts, abi: scoutsAbi, functionName: "latest" });
        setRoot({ root: r.root, count });
      })
      .catch(() => undefined);
  }, []);

  return (
    <Shell>
      <PageHeader title="Scouts" sub="Spot creators early. Your score rises as they grow." />
      <div className="border-b border-line px-4 py-3 text-xs text-muted">
        Backing a creator at 200 verified followers who reaches 20k is worth far more than backing at 15k. Scores reward hit rate, not volume, count only
        reputation-weighted followers, and are recomputed from public data.
        {root && <span className="text-good"> Latest score root posted onchain: {root.root.slice(0, 12)}… (#{root.count.toString()})</span>}
      </div>
      <YourPicks />
      <div className="flex gap-1 border-b border-line px-3 py-2">
        {TOPICS.map((t) => (
          <button key={t} className={`tab ${topic === t ? "tab-on" : ""}`} onClick={() => setTopic(t)}>
            {t ? `#${t}` : "All"}
          </button>
        ))}
      </div>
      {rows?.length === 0 && <p className="p-8 text-center text-sm text-muted">No scouts here yet.</p>}
      <div className="divide-y divide-line">
        {rows?.map((s, i) => (
          <div key={s.fid} className="flex items-center gap-3 px-4 py-3">
            <span className="w-6 text-center text-sm text-muted">{i + 1}</span>
            <Avatar fid={s.fid} handle={s.handle} src={s.avatar} size={36} />
            <div className="min-w-0 flex-1">
              <Link href={`/u/${s.handle ?? s.fid}`} className="font-medium hover:underline">@{s.handle ?? s.fid}</Link>
              <div className="flex flex-wrap gap-x-3 text-xs text-muted">
                {s.topFinds.slice(0, 3).map((f) => (
                  <span key={f.creator}>
                    found @{f.handle ?? f.creator} at {f.from} → {f.now}
                  </span>
                ))}
              </div>
            </div>
            <div className="text-right">
              <div className="font-semibold">{(s.score / 1000).toFixed(1)}</div>
              <div className="text-[11px] text-muted">{s.hits}/{s.backed} hits</div>
            </div>
            {s.scoutTier && <span className="chip bg-accent-soft text-accent">{s.scoutTier}</span>}
          </div>
        ))}
      </div>
    </Shell>
  );
}

type Picks = Awaited<ReturnType<typeof relay.picks>>;

/** The creators you backed, with growth since, updating live (the official score follows on the leaderboard). */
function YourPicks() {
  const { fid } = useSession();
  const [data, setData] = useState<Picks | null>(null);
  useEffect(() => {
    if (!fid) return;
    const load = () => relay.picks(fid).then(setData, () => undefined);
    load();
    const t = setInterval(load, 8_000);
    return () => clearInterval(t);
  }, [fid]);
  if (!fid || !data) return null;
  const total = data.picks.reduce((a, p) => a + p.points, 0);

  return (
    <section className="border-b border-line p-4">
      <div className="flex items-center gap-2">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold">
          <Gem size={18} className="text-accent" /> Your picks
        </h2>
        <span className="ml-auto text-sm text-muted">
          <b className="text-text">{(total / 1000).toFixed(1)}</b> pts so far
        </span>
      </div>
      {!data.canScore && (
        <p className="mt-2 rounded-xl bg-warn/10 px-3 py-2 text-xs text-warn">
          Your account's reputation is {pct(data.reputation)}; it needs 50% to earn scout points. Post a few times and let your account age a little.
        </p>
      )}
      {data.picks.length === 0 ? (
        <p className="mt-2 text-sm text-muted">
          Tap <b>Back</b> on a creator you don't follow yet (look for Discovery or Trial posts). As they grow, your picks show up here.
        </p>
      ) : (
        <div className="mt-3 grid gap-2">
          {data.picks.slice(0, 6).map((p) => (
            <Link key={p.creator} href={`/u/${p.handle ?? p.creator}`} className="card flex items-center gap-3 p-3 transition hover:shadow-pop">
              <Avatar fid={p.creator} handle={p.handle} src={p.avatar} size={40} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{p.displayName ?? `@${p.handle ?? p.creator}`}</div>
                <div className="text-xs text-muted">
                  backed {timeAgo(p.at)} ago at <b className="text-text">{p.verifiedFrom}</b> → now <b className="text-text">{p.verifiedNow}</b> verified followers
                </div>
              </div>
              {p.points > 0 ? (
                <span className={`chip ${p.hit ? "bg-good/12 text-good" : "bg-accent-soft text-accent"}`}>
                  <TrendingUp size={11} /> +{(p.points / 1000).toFixed(1)} pts
                </span>
              ) : (
                <span className="chip bg-panel-2 text-muted">waiting to grow</span>
              )}
            </Link>
          ))}
        </div>
      )}
      <p className="mt-2 text-[11px] text-muted">
        Points = how much a creator grew after you backed them (log₂ of verified followers now ÷ then). Only reputable followers count.
      </p>
    </section>
  );
}
