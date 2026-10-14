"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { CommunityInfo, FeedInfo } from "@monsoc/sdk";
import { isTopicFeed } from "@/lib/feeds";
import { communitiesAbi } from "@monsoc/sdk";
import { Shell, PageHeader } from "@/components/Shell";
import { useSession, relay, deployment } from "@/lib/session";
import { usd, errMsg, JOIN_LABEL } from "@/lib/format";
import cfg from "@/monsoc.config";

const toDataUri = (o: unknown) => `data:application/json;base64,${btoa(unescape(encodeURIComponent(JSON.stringify(o))))}`;

export default function Communities() {
  const { fid, call } = useSession();
  const [list, setList] = useState<CommunityInfo[]>([]);
  const [mine, setMine] = useState<Set<number>>(new Set());
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", rules: "", tags: "", joinType: "0", price: "5", feedId: "0" });
  const [styles, setStyles] = useState<FeedInfo[]>([]);
  useEffect(() => {
    relay.feeds().then((fs) => setStyles(fs.filter((f) => f.kind === "rule" && f.definition && !isTopicFeed(f))), () => undefined);
  }, []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = () => {
    relay.communities().then((cs) => setList(cfg.communityScope.length ? cs.filter((c) => cfg.communityScope.includes(c.id)) : cs));
    if (fid) relay.memberships(fid).then((m) => setMine(new Set(m.map((x) => x.communityId))));
  };
  useEffect(load, [fid]);

  const create = async () => {
    if (!fid) return;
    setBusy(true);
    setErr(null);
    try {
      const meta = {
        name: form.name,
        description: form.description,
        rules: form.rules.split("\n").filter(Boolean),
        tags: form.tags.split(/[ ,]+/).filter(Boolean).map((t) => t.replace(/^#/, "")),
        rooms: ["general"],
        chatRetentionDays: 30,
      };
      const jt = Number(form.joinType);
      await call(deployment.communities, communitiesAbi, "create", [
        BigInt(fid), jt, jt === 1 ? deployment.tusd : "0x0000000000000000000000000000000000000000", jt === 1 ? 1_000_000n : 0n,
        jt === 3 ? BigInt(Math.round(Number(form.price) * 1e6)) : 0n, jt === 3 ? 30n * 86400n : 0n, BigInt(form.feedId), toDataUri(meta),
      ]);
      setCreating(false);
      setTimeout(load, 1500);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      <PageHeader
        title="Communities"
        sub="Members, roles and bans live onchain, so every client agrees on who's in."
        right={fid && <button className="btn-primary btn-sm" onClick={() => setCreating(!creating)}>{creating ? "Close" : "+ New"}</button>}
      />
      {creating && (
        <div className="space-y-2 border-b border-line p-4">
          <input className="input" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className="input" placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <textarea className="input" placeholder="Rules (one per line)" value={form.rules} onChange={(e) => setForm({ ...form, rules: e.target.value })} />
          <input className="input" placeholder="Topics, e.g. ai monad" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
          <div className="flex items-center gap-2 text-sm">
            <select className="input w-auto" value={form.joinType} onChange={(e) => setForm({ ...form, joinType: e.target.value })}>
              <option value="0">Open</option>
              <option value="1">Token-gated (≥1 tUSD)</option>
              <option value="2">Invite-only</option>
              <option value="3">Paid</option>
            </select>
            <select className="input w-auto" value={form.feedId} onChange={(e) => setForm({ ...form, feedId: e.target.value })} title="How the community feed is ranked">
              <option value="0">Ranking: default</option>
              {styles.map((f) => (
                <option key={f.id} value={f.id}>Ranking: {f.name}</option>
              ))}
            </select>
            {form.joinType === "3" && (
              <label className="flex items-center gap-1">$<input className="input w-20" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /> / 30d</label>
            )}
            <button className="btn-primary ml-auto" disabled={busy || !form.name} onClick={create}>{busy ? "Creating…" : "Create"}</button>
          </div>
          {err && <p className="text-xs text-bad">{err}</p>}
        </div>
      )}
      <div className="divide-y divide-line">
        {list.map((c) => (
          <Link key={c.id} href={`/c/${c.id}`} className="flex items-center gap-4 px-4 py-4 hover:bg-panel">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-xl text-accent">{c.name.slice(0, 1)}</div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{c.name}</span>
                {mine.has(c.id) && <span className="chip bg-good/15 text-good">member</span>}
              </div>
              <p className="truncate text-sm text-muted">{c.description}</p>
              <p className="text-xs text-muted">{c.memberCount} members · {c.rooms.length} chat rooms {c.tags.map((t) => ` · #${t}`).join("")}</p>
            </div>
            <span className="chip bg-panel-2 text-muted">{JOIN_LABEL[c.joinType]}{c.joinType === "paid" ? ` ${usd(c.priceUsd)}` : ""}</span>
          </Link>
        ))}
      </div>
    </Shell>
  );
}
