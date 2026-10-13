"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Hex } from "viem";
import type { TrialResults, PostView } from "@monsoc/sdk";
import { Shell, PageHeader } from "@/components/Shell";
import { Composer } from "@/components/Composer";
import { useSession, relay } from "@/lib/session";
import { errMsg, pct, timeAgo } from "@/lib/format";

export default function Trials() {
  const { fid, send } = useSession();
  const [trials, setTrials] = useState<TrialResults[] | null>(null);
  const [posts, setPosts] = useState<Record<string, PostView>>({});
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!fid) return;
    const ts = await relay.myTrials(fid);
    setTrials(ts);
    const hashes = ts.flatMap((t) => t.variants.map((v) => v.hash));
    const ps = await relay.posts(hashes);
    setPosts(Object.fromEntries(ps.map((p) => [p.hash, p])));
  }, [fid]);
  useEffect(() => {
    load().catch((e) => setErr(errMsg(e)));
    const t = setInterval(() => load().catch(() => undefined), 8000);
    return () => clearInterval(t);
  }, [load]);

  const release = (hash: Hex) => send("trial-release", { target: hash }).then(load).catch((e) => setErr(errMsg(e)));
  const drop = (hash: Hex) => send("delete", { target: hash }).then(load).catch((e) => setErr(errMsg(e)));

  if (!fid) return <Shell><PageHeader title="Trials" /><p className="p-6 text-sm text-muted"><Link href="/onboarding" className="text-accent">Sign in</Link> to run trials.</p></Shell>;

  return (
    <Shell>
      <PageHeader title="Trial posts & reels" sub="Test with strangers first. Release to followers when it works." />
      <Composer placeholder="Draft a trial: pick a topic, tap the flask, optionally A/B two hooks" onPosted={load} />
      {err && <p className="p-4 text-sm text-bad">{err}</p>}
      {trials?.length === 0 && <p className="p-8 text-center text-sm text-muted">No trials yet. Tap the flask icon in the composer to start one.</p>}
      <div className="space-y-4 p-4">
        {trials?.map((t) => {
          const best = [...t.variants].sort((a, b) => b.engagementRate - a.engagementRate)[0]!;
          return (
            <div key={t.hash} className="card p-4">
              <div className="flex items-center gap-2">
                <span className={`chip ${t.status === "released" ? "bg-good/15 text-good" : t.status === "dropped" ? "bg-bad/15 text-bad" : "bg-accent-soft text-accent"}`}>
                  {t.status === "testing" ? "testing" : t.status}
                </span>
                {t.variants.length > 1 && <span className="chip bg-panel-2 text-muted">A/B</span>}
                {t.autoRelease && t.status === "testing" && (
                  <span className="text-xs text-muted">
                    auto-release if &gt; your avg ({pct(t.creatorAverageRate)}) · window ends {t.autoRelease.endsAt > Date.now() ? `in ${timeAgo(Date.now() - (t.autoRelease.endsAt - Date.now()))}` : "now"}
                  </span>
                )}
              </div>
              <div className={`mt-3 grid gap-3 ${t.variants.length > 1 ? "sm:grid-cols-2" : ""}`}>
                {t.variants.map((v) => {
                  const p = posts[v.hash];
                  const winner = t.variants.length > 1 && v.hash === best.hash && best.reach > 0;
                  return (
                    <div key={v.hash} className={`rounded-xl border p-3 ${winner ? "border-good/60" : "border-line"}`}>
                      <div className="flex items-center gap-2 text-xs text-muted">
                        {v.variant && <span className="chip bg-panel-2">Variant {v.variant}</span>}
                        {winner && <span className="chip bg-good/15 text-good">leading</span>}
                        {p?.trial?.status && p.trial.status !== "testing" && <span>{p.trial.status}</span>}
                      </div>
                      <Link href={`/post/${v.hash}`} className="mt-1 block text-sm">{p?.text ?? "…"}</Link>
                      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                        <Stat label="reach" value={v.reach} />
                        <Stat label="engagement" value={pct(v.engagementRate)} />
                        <Stat label="follows gained" value={v.followsGained} />
                        <Stat label="likes" value={v.likes} />
                        <Stat label="replies" value={v.replies} />
                        <Stat label="backs" value={v.backs} />
                        <Stat label="avg watch" value={`${Math.round(v.avgDwellMs / 1000)}s`} />
                        <Stat label="completion" value={pct(v.completion)} />
                        <Stat label="views" value={v.views} />
                      </div>
                      {t.status === "testing" && p?.trial?.status === "testing" && (
                        <div className="mt-3 flex gap-2">
                          <button className="btn-primary btn-sm" onClick={() => release(v.hash)}>Release to followers</button>
                          <button className="btn-ghost btn-sm" onClick={() => drop(v.hash)}>Drop</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </Shell>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-panel-2 px-2 py-1.5">
      <div className="text-sm font-semibold">{value}</div>
      <div className="text-[10px] text-muted">{label}</div>
    </div>
  );
}
