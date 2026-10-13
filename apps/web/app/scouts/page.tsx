"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { scoutsAbi } from "@monsoc/sdk";
import { Shell, PageHeader } from "@/components/Shell";
import { Avatar } from "@/components/Avatar";
import { relay, publicClient, deployment } from "@/lib/session";

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
