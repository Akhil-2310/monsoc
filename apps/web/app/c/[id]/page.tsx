"use client";
import Link from "next/link";
import { use, useCallback, useEffect, useRef, useState } from "react";
import type { CommunityInfo, FeedInfo, Profile, SignedMessage } from "@monsoc/sdk";
import { communitiesAbi, tusdAbi } from "@monsoc/sdk";
import { Shell, PageHeader } from "@/components/Shell";
import { FeedView } from "@/components/FeedView";
import { Composer } from "@/components/Composer";
import { Avatar } from "@/components/Avatar";
import { useSession, relay, deployment } from "@/lib/session";
import { isTopicFeed } from "@/lib/feeds";
import { SlidersHorizontal } from "lucide-react";
import { usd, errMsg, timeAgo, JOIN_LABEL } from "@/lib/format";

type Detail = CommunityInfo & { members: (Profile & { role: number })[] };
const ROLE = ["", "member", "moderator", "owner"];

/** Community feed: "posts in this community, ranked our way". Falls back to recency if none is set. */
function communityFeed(c: CommunityInfo, registry: FeedInfo[]): FeedInfo {
  const f = registry.find((x) => x.id === c.feedId);
  const base = f?.definition;
  return {
    id: f?.id ?? 0,
    ownerFid: c.ownerFid,
    ownerHandle: null,
    kind: "rule",
    name: `${c.name} feed`,
    description: "",
    uri: f?.uri ?? "",
    defHash: f?.defHash ?? "0x",
    version: f?.version ?? 1,
    priceUsd: 0,
    creatorShareBps: 0,
    discoveryBps: Math.round((base?.discovery ?? 0.1) * 10_000),
    active: true,
    endpoint: null,
    subscribers: 0,
    definition: {
      version: 1,
      name: `${c.name} feed`,
      sources: { communities: [c.id] },
      filters: { excludeLabels: ["spam", "engagement-bait", "hidden"] },
      weights: base?.weights ?? { replies: 2, likes: 1, recencyHalfLifeHours: 24 },
      sort: base?.sort,
      discovery: base?.discovery ?? 0.1,
    },
  };
}

export default function CommunityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const cid = Number(id);
  const { fid, appKey, call } = useSession();
  const [c, setC] = useState<Detail | null>(null);
  const [feeds, setFeeds] = useState<FeedInfo[]>([]);
  const [tab, setTab] = useState<"feed" | "chat" | "members">("feed");
  const [room, setRoom] = useState("general");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const load = useCallback(() => {
    relay.community(cid).then(setC).catch((e) => setErr(errMsg(e)));
  }, [cid]);
  useEffect(() => {
    load();
    relay.feeds().then(setFeeds);
  }, [load]);

  if (!c) return <Shell><p className="p-6 text-muted">{err ?? "Loading…"}</p></Shell>;
  const me = c.members.find((m) => m.fid === fid);
  const isMod = (me?.role ?? 0) >= 2;

  const join = async () => {
    if (!fid || !appKey) return;
    setBusy(true);
    setErr(null);
    try {
      if (c.joinType === "paid") {
        await relay.faucet(appKey.address).catch(() => undefined);
        await call(deployment.tusd, tusdAbi, "approve", [deployment.payments, 2n ** 255n]);
        await call(deployment.communities, communitiesAbi, "joinPaid", [BigInt(cid), BigInt(fid), deployment.tusd]);
      } else {
        await call(deployment.communities, communitiesAbi, "join", [BigInt(cid), BigInt(fid)]);
      }
      setTimeout(load, 1200);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const joinHint =
    c.joinType === "token" ? "Requires holding ≥1 tUSD in your wallet (custody). Get some on the Wallet page." : c.joinType === "invite" ? "Ask a moderator for an invite." : c.joinType === "paid" ? `${usd(c.priceUsd)} per 30 days, paid in tUSD.` : "";

  return (
    <Shell>
      <PageHeader title={c.name} sub={`${c.memberCount} members · ${JOIN_LABEL[c.joinType]}`} right={
        me ? <span className="chip bg-good/15 text-good">{ROLE[me.role]}</span> : fid && (
          <button className="btn-primary btn-sm" disabled={busy || c.joinType === "invite"} onClick={join}>
            {busy ? "Joining…" : c.joinType === "paid" ? `Join · ${usd(c.priceUsd)}` : "Join"}
          </button>
        )
      } />
      <div className="border-b border-line px-4 py-3 text-sm">
        <p>{c.description}</p>
        {c.rules.length > 0 && (
          <ul className="mt-2 list-inside list-disc text-xs text-muted">
            {c.rules.map((r) => <li key={r}>{r}</li>)}
          </ul>
        )}
        {!me && joinHint && <p className="mt-2 text-xs text-muted">{joinHint}</p>}
        {err && <p className="mt-2 text-xs text-bad">{err}</p>}
      </div>
      <div className="flex gap-1 border-b border-line px-3 py-2">
        {(["feed", "chat", "members"] as const).map((t) => (
          <button key={t} className={`tab capitalize ${tab === t ? "tab-on" : ""}`} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>
      {tab === "feed" && (
        <>
          <CommunityRanking c={c} feeds={feeds} canEdit={isMod} onChanged={load} />
          {me && <Composer community={cid} placeholder={`Post to ${c.name}…`} onPosted={() => setReload((r) => r + 1)} />}
          <FeedView key={c.feedId} feed={communityFeed(c, feeds)} community={cid} reloadKey={reload} />
        </>
      )}
      {tab === "chat" && (
        <>
          <div className="flex gap-1 border-b border-line px-3 py-2">
            {c.rooms.map((r) => (
              <button key={r} className={`tab ${room === r ? "tab-on" : ""}`} onClick={() => setRoom(r)}># {r}</button>
            ))}
          </div>
          <ChatRoom community={cid} room={room} canPost={!!me} />
        </>
      )}
      {tab === "members" && (
        <div className="divide-y divide-line">
          {c.members.map((m) => (
            <div key={m.fid} className="flex items-center gap-3 px-4 py-2">
              <Avatar fid={m.fid} handle={m.handle} src={m.avatar} size={32} />
              <Link href={`/u/${m.handle ?? m.fid}`} className="flex-1 text-sm font-medium">{m.displayName ?? `@${m.handle ?? m.fid}`}</Link>
              <span className="chip bg-panel-2 text-muted">{ROLE[m.role]}</span>
              {isMod && m.role < (me?.role ?? 0) && (
                <button
                  className="btn-ghost btn-sm text-bad"
                  onClick={() => call(deployment.communities, communitiesAbi, "setBan", [BigInt(cid), BigInt(fid!), BigInt(m.fid), true]).then(() => setTimeout(load, 1200)).catch((e) => setErr(errMsg(e)))}
                >
                  Ban
                </button>
              )}
            </div>
          ))}
          {isMod && <InviteBox cid={cid} onDone={load} />}
        </div>
      )}
    </Shell>
  );
}

function InviteBox({ cid, onDone }: { cid: number; onDone: () => void }) {
  const { fid, call } = useSession();
  const [h, setH] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const invite = async () => {
    try {
      const u = await relay.user(h.replace(/^@/, ""));
      await call(deployment.communities, communitiesAbi, "invite", [BigInt(cid), BigInt(fid!), BigInt(u.fid)]);
      setMsg(`Invited @${u.handle}`);
      onDone();
    } catch (e) {
      setMsg(errMsg(e));
    }
  };
  return (
    <div className="flex items-center gap-2 px-4 py-3">
      <input className="input" placeholder="@handle to invite" value={h} onChange={(e) => setH(e.target.value)} />
      <button className="btn-ghost btn-sm" onClick={invite}>Invite</button>
      {msg && <span className="text-xs text-muted">{msg}</span>}
    </div>
  );
}

/** Live room: signed messages through the relay in real time; not anchored; history per community setting. */
function ChatRoom({ community, room, canPost }: { community: number; room: string; canPost: boolean }) {
  const { send, fid } = useSession();
  const [msgs, setMsgs] = useState<SignedMessage<"chat">[]>([]);
  const [handles, setHandles] = useState<Record<number, string>>({});
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMsgs([]);
    relay.chat(community, room).then(setMsgs);
    return relay.stream((m) => {
      if (m.data.type !== "chat") return;
      const b = (m as SignedMessage<"chat">).data.body;
      if (b.community !== community || b.room !== room) return;
      setMsgs((prev) => (prev.some((x) => x.hash === m.hash) ? prev : [...prev, m as SignedMessage<"chat">]));
    });
  }, [community, room]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
    const missing = [...new Set(msgs.map((m) => m.data.fid))].filter((f) => !handles[f]);
    if (missing.length)
      Promise.all(missing.map((f) => relay.user(f).catch(() => null))).then((ps) =>
        setHandles((h) => ({ ...h, ...Object.fromEntries(ps.filter(Boolean).map((p) => [p!.fid, p!.handle ?? String(p!.fid)])) })),
      );
  }, [msgs, handles]);

  const post = async () => {
    if (!text.trim()) return;
    setErr(null);
    const t = text;
    setText("");
    try {
      await send("chat", { community, room, text: t });
    } catch (e) {
      setText(t);
      setErr(errMsg(e));
    }
  };

  return (
    <div className="flex h-[60vh] flex-col">
      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {msgs.length === 0 && <p className="text-center text-sm text-muted">No messages yet.</p>}
        {msgs.map((m) => (
          <div key={m.hash} className={`flex gap-2 ${m.data.fid === fid ? "flex-row-reverse" : ""}`}>
            <Avatar fid={m.data.fid} handle={handles[m.data.fid]} size={28} />
            <div className={`max-w-[75%] rounded-2xl px-3 py-1.5 text-sm ${m.data.fid === fid ? "bg-accent text-on-accent" : "bg-panel-2"}`}>
              <div className="text-[11px] opacity-70">@{handles[m.data.fid] ?? m.data.fid} · {timeAgo(m.data.timestamp)}</div>
              {m.data.body.text}
            </div>
          </div>
        ))}
        <div ref={bottom} />
      </div>
      {canPost ? (
        <div className="flex gap-2 border-t border-line p-3">
          <input className="input" placeholder={`Message #${room}`} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && post()} />
          <button className="btn-primary" onClick={post}>Send</button>
        </div>
      ) : (
        <p className="border-t border-line p-3 text-center text-xs text-muted">Join to chat.</p>
      )}
      {err && <p className="px-3 pb-2 text-xs text-bad">{err}</p>}
    </div>
  );
}

/**
 * The community decides how its own feed is ranked (spec: "communities decide what their own feeds reward").
 * Moderators pick a ranking style; the choice is stored onchain in the CommunityRegistry.
 */
function CommunityRanking({ c, feeds, canEdit, onChanged }: { c: CommunityInfo; feeds: FeedInfo[]; canEdit: boolean; onChanged: () => void }) {
  const { fid, call } = useSession();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const styles = feeds.filter((f) => f.kind === "rule" && f.definition && !isTopicFeed(f));
  const current = styles.find((f) => f.id === c.feedId);

  const change = async (feedId: number) => {
    if (!fid) return;
    setBusy(true);
    setErr(null);
    try {
      await call(deployment.communities, communitiesAbi, "update", [BigInt(c.id), BigInt(fid), c.uri, BigInt(feedId)]);
      setTimeout(onChanged, 1500);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-2.5 text-sm">
      <SlidersHorizontal size={14} className="text-muted" />
      <span className="text-muted">Ranked by</span>
      {canEdit ? (
        <select
          className="rounded-full border border-line bg-panel px-3 py-1 text-xs font-semibold"
          value={c.feedId}
          disabled={busy}
          onChange={(e) => change(Number(e.target.value))}
        >
          <option value={0}>Default (replies first)</option>
          {styles.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
      ) : (
        <span className="chip bg-accent-soft text-accent">{current?.name ?? "Default (replies first)"}</span>
      )}
      <span className="hidden truncate text-xs text-muted sm:inline">{current?.description ?? "Conversations ranked above likes, newest first."}</span>
      {busy && <span className="text-xs text-muted">Saving…</span>}
      {err && <span className="text-xs text-bad">{err}</span>}
    </div>
  );
}
