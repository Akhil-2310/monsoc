"use client";
import Link from "next/link";
import type { Hex } from "viem";
import { useEffect, useRef, useState } from "react";
import type { PostView, RankReason } from "@monsoc/sdk";
import { paymentsAbi, tusdAbi, mediaUrl } from "@monsoc/sdk";
import { useSession, deployment } from "@/lib/session";
import { timeAgo, errMsg } from "@/lib/format";
import { Avatar } from "./Avatar";
import { useCreatorMarket, useMarket } from "@/lib/useMarkets";
import { MarketCard } from "./MarketCard";
import cfg from "@/monsoc.config";

const viewed = new Set<string>();

/** Sends one signed `view` per post per session when it's actually on screen. Drives trial reach + payouts. */
function useViewTracker(post: PostView, feedId: number) {
  const ref = useRef<HTMLElement>(null);
  const { send, fid } = useSession();
  useEffect(() => {
    const el = ref.current;
    if (!el || !fid || post.fid === fid || viewed.has(post.hash)) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const start = Date.now();
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          timer = setTimeout(() => {
            if (viewed.has(post.hash)) return;
            viewed.add(post.hash);
            send("view", { target: post.hash, feedId, dwellMs: Date.now() - start }).catch(() => viewed.delete(post.hash));
          }, 1200);
        } else if (timer) clearTimeout(timer);
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [post.hash, post.fid, feedId, fid, send]);
  return ref;
}

const LABEL_STYLE: Record<string, string> = {
  spam: "bg-bad/15 text-bad",
  scam: "bg-bad/15 text-bad",
  "engagement-bait": "bg-warn/15 text-warn",
  giveaway: "bg-warn/15 text-warn",
};

function RichText({ text }: { text: string }) {
  const parts = text.split(/(#[a-z0-9_]+|https?:\/\/[^\s)]+)/gi);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("#") ? (
          <span key={i} className="text-accent">{p}</span>
        ) : p.startsWith("http") ? (
          <a key={i} href={p} target="_blank" rel="noreferrer" className="text-accent underline">{p}</a>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

export function PostCard({
  post,
  reason,
  feedId = 0,
  compact = false,
}: {
  post: PostView;
  reason?: RankReason;
  feedId?: number;
  compact?: boolean;
}) {
  const ref = useViewTracker(post, feedId);
  const { fid, send, call, following, setFollow, muted, blocked, setRelation } = useSession();
  // hash of the viewer's own like/repost message, so it can be undone with a signed `delete`
  const [likeHash, setLikeHash] = useState<Hex | null>(post.viewer?.like ?? null);
  const [repostHash, setRepostHash] = useState<Hex | null>(post.viewer?.repost ?? null);
  const [backed, setBacked] = useState(post.viewer?.backed ?? false);
  const [removed, setRemoved] = useState(false);
  const [menu, setMenu] = useState(false);
  const creatorMarket = useCreatorMarket(post.fid);
  const attached = useMarket(post.market);
  // the chip points at the author's own live market, unless the post already embeds that market
  const market = creatorMarket && creatorMarket.id !== post.market ? creatorMarket : undefined;
  const [stats, setStats] = useState(post.stats);
  const [err, setErr] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const isOwn = fid === post.fid;
  const isStranger = !isOwn && !following.has(post.fid);
  const flagged = post.labels.some((l) => ["spam", "scam"].includes(l));

  const act = async (fn: () => Promise<unknown>, optimistic: () => void, undo: () => void) => {
    setErr(null);
    optimistic();
    try {
      await fn();
    } catch (e) {
      undo();
      setErr(errMsg(e));
    }
  };

  const PENDING = "0xpending" as Hex;
  const toggleLike = () =>
    likeHash
      ? act(
          () => send("delete", { target: likeHash }),
          () => (setLikeHash(null), setStats((s) => ({ ...s, likes: s.likes - 1 }))),
          () => (setLikeHash(likeHash), setStats((s) => ({ ...s, likes: s.likes + 1 }))),
        )
      : act(
          async () => setLikeHash((await send("like", { target: post.hash })).hash),
          () => (setLikeHash(PENDING), setStats((s) => ({ ...s, likes: s.likes + 1 }))),
          () => (setLikeHash(null), setStats((s) => ({ ...s, likes: s.likes - 1 }))),
        );
  const toggleRepost = () =>
    repostHash
      ? act(
          () => send("delete", { target: repostHash }),
          () => (setRepostHash(null), setStats((s) => ({ ...s, reposts: s.reposts - 1 }))),
          () => (setRepostHash(repostHash), setStats((s) => ({ ...s, reposts: s.reposts + 1 }))),
        )
      : act(
          async () => setRepostHash((await send("repost", { target: post.hash })).hash),
          () => (setRepostHash(PENDING), setStats((s) => ({ ...s, reposts: s.reposts + 1 }))),
          () => (setRepostHash(null), setStats((s) => ({ ...s, reposts: s.reposts - 1 }))),
        );
  const remove = () =>
    confirm("Delete this post? It disappears from every client; the anchored record shows it was deleted.") &&
    act(() => send("delete", { target: post.hash }), () => setRemoved(true), () => setRemoved(false));
  const relate = (kind: "mute" | "block") =>
    act(() => setRelation(kind, post.fid, true), () => setMenu(false), () => undefined);

  const back = () =>
    act(
      () => send("back", { targetFid: post.fid, target: post.hash }),
      () => (setBacked(true), setStats((s) => ({ ...s, backs: s.backs + 1 }))),
      () => (setBacked(false), setStats((s) => ({ ...s, backs: s.backs - 1 }))),
    );
  const tip = () =>
    act(
      async () => {
        await call(deployment.tusd, tusdAbi, "approve", [deployment.payments, 2n ** 255n]);
        await call(deployment.payments, paymentsAbi, "tip", [BigInt(post.fid), deployment.tusd, 1_000_000n]);
      },
      () => undefined,
      () => undefined,
    );

  if (removed) return null;
  if (!isOwn && (muted.has(post.fid) || blocked.has(post.fid)))
    return (
      <div className="border-b border-line px-4 py-2 text-xs text-muted">
        Post from {blocked.has(post.fid) ? "an account you blocked" : "an account you muted"}.
      </div>
    );

  return (
    <article ref={ref} className={`border-b border-line px-4 py-3 ${compact ? "" : "hover:bg-panel/60"}`}>
      {(reason === "discovery" || reason === "trial" || post.trial) && (
        <div className="mb-1.5 flex items-center gap-2 pl-12 text-[11px] text-muted">
          {reason === "trial" || post.trial?.status === "testing" ? (
            <span className="chip bg-accent-soft text-accent">◎ Trial · shown to non-followers first</span>
          ) : post.trial?.status === "released" ? (
            <span className="chip bg-good/15 text-good">✓ Released from trial</span>
          ) : (
            <span className="chip bg-panel-2 text-muted">✦ Discovery · someone you don't follow</span>
          )}
          {post.trial?.variant && <span className="chip bg-panel-2">variant {post.trial.variant}</span>}
        </div>
      )}
      <div className="flex gap-3">
        <Link href={`/u/${post.handle ?? post.fid}`}>
          <Avatar fid={post.fid} handle={post.handle} src={post.avatar} />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm">
            <Link href={`/u/${post.handle ?? post.fid}`} className="min-w-0 truncate hover:underline">
              {post.displayName ? (
                <>
                  <span className="font-semibold">{post.displayName}</span> <span className="text-muted">@{post.handle ?? post.fid}</span>
                </>
              ) : (
                <span className="font-semibold">@{post.handle ?? post.fid}</span>
              )}
            </Link>
            <span className="text-muted">· {timeAgo(post.timestamp)}</span>
            {post.community !== null && (
              <Link href={`/c/${post.community}`} className="chip bg-panel-2 text-muted hover:text-text">
                community #{post.community}
              </Link>
            )}
            <span className="ml-auto flex items-center gap-2">
              {isStranger && fid && (
                <button className="text-xs text-accent hover:underline" onClick={() => setFollow(post.fid, true).catch((e) => setErr(errMsg(e)))}>
                  Follow
                </button>
              )}
              {fid && (
                <span className="relative">
                  <button className="rounded-full px-1.5 text-muted hover:bg-panel-2 hover:text-text" onClick={() => setMenu(!menu)} aria-label="More">
                    ⋯
                  </button>
                  {menu && (
                    <div className="absolute right-0 top-6 z-20 w-44 overflow-hidden rounded-xl border border-line bg-panel shadow-xl" onMouseLeave={() => setMenu(false)}>
                      {isOwn ? (
                        <button className="block w-full px-3 py-2 text-left text-sm text-bad hover:bg-panel-2" onClick={remove}>
                          Delete post
                        </button>
                      ) : (
                        <>
                          <button className="block w-full px-3 py-2 text-left text-sm hover:bg-panel-2" onClick={() => relate("mute")}>
                            Mute @{post.handle ?? post.fid}
                          </button>
                          <button className="block w-full px-3 py-2 text-left text-sm text-bad hover:bg-panel-2" onClick={() => relate("block")}>
                            Block @{post.handle ?? post.fid}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </span>
              )}
            </span>
          </div>

          {market && cfg.plugins.markets && (
            <Link
              href={`/m/${market.id}`}
              className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent-soft px-2 py-0.5 text-[11px] text-accent hover:bg-accent/20"
              title="A live milestone market on this creator"
            >
              <span>↗ Market</span>
              <span className="text-muted">·</span>
              <span>
                {market.counted}/{market.target} followers
              </span>
              <span className="text-muted">·</span>
              <span className="text-good">YES {Math.round(market.yesShare * 100)}%</span>
            </Link>
          )}
          {post.labels.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {post.labels.map((l) => (
                <span key={l} className={`chip ${LABEL_STYLE[l] ?? "bg-panel-2 text-muted"}`}>⚑ {l}</span>
              ))}
            </div>
          )}

          {flagged && !revealed ? (
            <button className="mt-2 text-sm text-muted underline" onClick={() => setRevealed(true)}>
              Hidden by your labelers. Show anyway
            </button>
          ) : (
            <Link href={`/post/${post.hash}`} className="block">
              <p className="mt-1 whitespace-pre-wrap break-words text-[15px] leading-relaxed">
                <RichText text={post.text} />
              </p>
              {post.media && post.media.length > 0 && (
                <div className={`mt-2 grid gap-1.5 overflow-hidden rounded-xl ${post.media.length > 1 ? "grid-cols-2" : ""}`}>
                  {post.media.map((m) =>
                    m.kind === "video" ? (
                      <video
                        key={m.uri}
                        src={mediaUrl(m.uri)}
                        controls
                        playsInline
                        preload="metadata"
                        className="max-h-[520px] w-full rounded-xl border border-line bg-black"
                        style={m.width && m.height ? { aspectRatio: `${m.width} / ${m.height}` } : undefined}
                        onClick={(e) => e.preventDefault()}
                      />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={m.uri}
                        src={mediaUrl(m.uri, { w: post.media!.length > 1 ? 600 : 1200 })}
                        alt=""
                        loading="lazy"
                        className={`w-full rounded-xl border border-line object-cover ${post.media!.length > 1 ? "aspect-square" : "max-h-[520px]"}`}
                      />
                    ),
                  )}
                </div>
              )}
            </Link>
          )}

          {post.market && cfg.plugins.markets && (
            <div className="mt-2">
              {attached ? <MarketCard m={attached} /> : <div className="h-24 animate-pulse rounded-2xl bg-panel-2" />}
            </div>
          )}
          <div className="mt-2 flex items-center gap-5 text-[13px] text-muted">
            <Link href={`/post/${post.hash}`} className="hover:text-text">↩ {stats.replies}</Link>
            <button disabled={!fid || repostHash === PENDING} onClick={toggleRepost} title={repostHash ? "Undo repost" : "Repost"} className={`hover:text-good ${repostHash ? "text-good" : ""}`}>⟲ {stats.reposts}</button>
            <button disabled={!fid || likeHash === PENDING} onClick={toggleLike} title={likeHash ? "Unlike" : "Like"} className={`hover:text-bad ${likeHash ? "text-bad" : ""}`}>{likeHash ? "♥" : "♡"} {stats.likes}</button>
            {cfg.plugins.scouts && !isOwn && (isStranger || post.trial) && (
              <button
                disabled={!fid || backed}
                onClick={back}
                title="Back this creator early. Your scout score rises as they grow."
                className={`hover:text-accent ${backed ? "text-accent" : ""}`}
              >
                ◆ {backed ? "Backed" : "Back"} {stats.backs > 0 && stats.backs}
              </button>
            )}
            {cfg.plugins.tipping && !isOwn && fid && (
              <button onClick={tip} className="hover:text-warn" title="Tip $1 in tUSD">$ tip</button>
            )}
            <span className="ml-auto flex items-center gap-2 text-[11px]">
              {stats.views > 0 && <span>{stats.views} views</span>}
              <Link href={`/post/${post.hash}`} title={post.anchored ? "Anchored on Monad: provably unaltered" : "Waiting for the next anchor batch"}>
                {post.anchored ? <span className="text-good">⛓ anchored</span> : <span>⧗ pending</span>}
              </Link>
            </span>
          </div>
          {err && <p className="mt-1 text-xs text-bad">{err}</p>}
        </div>
      </div>
    </article>
  );
}
