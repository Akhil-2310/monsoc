"use client";
import { Fragment, useCallback, useEffect, useState } from "react";
import type { FeedInfo } from "@monsoc/sdk";
import { paymentsAbi, tusdAbi } from "@monsoc/sdk";
import { useSession, relay, deployment } from "@/lib/session";
import { loadFeed, type FeedResult } from "@/lib/feeds";
import { usd, errMsg, pct } from "@/lib/format";
import { PostCard } from "./PostCard";
import { MarketCard } from "./MarketCard";
import { useLiveMarkets } from "@/lib/useMarkets";

/** After every MARKET_EVERY posts, a live market card (each market shown once per feed load). */
const MARKET_EVERY = 6;

export function FeedView({
  feed,
  community,
  reloadKey = 0,
  showMarkets = false,
}: {
  feed: FeedInfo;
  community?: number;
  reloadKey?: number;
  showMarkets?: boolean;
}) {
  const liveMarkets = useLiveMarkets();
  const { fid, appKey, call } = useSession();
  const [res, setRes] = useState<FeedResult | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  const load = useCallback(async () => {
    setErr(null);
    try {
      let sub = false;
      if (fid && feed.priceUsd > 0) sub = (await relay.subscriptions(fid)).some((s) => s.feedId === feed.id);
      setSubscribed(sub);
      setRes(await loadFeed(feed, fid ?? 0, sub, community));
    } catch (e) {
      setErr(errMsg(e));
    }
  }, [feed, fid, community]);

  useEffect(() => {
    setRes(null);
    load();
  }, [load, reloadKey]);

  // live: refresh when new posts land
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const stop = relay.stream((m) => {
      if (!["post", "trial-post", "like", "reply"].includes(m.data.type)) return;
      if (t) clearTimeout(t);
      t = setTimeout(load, 800);
    });
    return () => {
      stop();
      if (t) clearTimeout(t);
    };
  }, [load]);

  const subscribe = async () => {
    if (!fid || !appKey) return;
    setPaying(true);
    setErr(null);
    try {
      await relay.faucet(appKey.address).catch(() => undefined); // testnet: make sure the app key has tUSD
      await call(deployment.tusd, tusdAbi, "approve", [deployment.payments, 2n ** 255n]);
      await call(deployment.payments, paymentsAbi, "subscribe", [BigInt(fid), BigInt(feed.id), deployment.tusd, 1]);
      setSubscribed(true);
      setRes(await loadFeed(feed, fid, true, community));
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setPaying(false);
    }
  };

  // markets relevant to this feed first (creators who appear in it), then the rest by activity
  const marketsForFeed = !showMarkets
    ? []
    : (() => {
        const inFeed = new Set(res?.items.map((i) => i.post.fid) ?? []);
        return [...liveMarkets].sort(
          (a, b) =>
            Number(inFeed.has(b.creator?.fid ?? 0)) - Number(inFeed.has(a.creator?.fid ?? 0)) ||
            Number(b.yesPool) + Number(b.noPool) - (Number(a.yesPool) + Number(a.noPool)),
        );
      })();

  if (err) return <p className="p-6 text-sm text-bad">{err}</p>;
  if (!res) return <FeedSkeleton />;

  if (res.locked)
    return (
      <div className="m-4 card p-6 text-center">
        <div className="text-3xl">≋</div>
        <h3 className="mt-2 text-lg font-semibold">{feed.name}</h3>
        <p className="mt-1 text-sm text-muted">{feed.description}</p>
        <p className="mt-3 text-sm">
          <b>{usd(feed.priceUsd)}</b> / 30 days · {pct(feed.creatorShareBps / 10_000)} goes to the creators it surfaces for you
        </p>
        {fid ? (
          <button className="btn-primary mt-4" disabled={paying} onClick={subscribe}>
            {paying ? "Subscribing…" : `Subscribe for ${usd(feed.priceUsd)} in tUSD`}
          </button>
        ) : (
          <p className="mt-4 text-sm text-muted">Sign in to subscribe.</p>
        )}
        <p className="mt-2 text-[11px] text-muted">Priced in dollars, paid in a stablecoin or MON. Testnet tUSD is topped up automatically.</p>
      </div>
    );

  return (
    <div>
      {res.noDiscovery && (
        <div className="border-b border-line bg-warn/10 px-4 py-2 text-xs text-warn">This feed skips the protocol discovery slot: new creators won't reach you here.</div>
      )}
      {subscribed && <div className="border-b border-line bg-good/10 px-4 py-2 text-xs text-good">Subscribed: your views pay the creators shown here.</div>}
      {res.items.length === 0 && <p className="p-8 text-center text-sm text-muted">Nothing here yet. Follow people or pick another feed.</p>}
      {res.items.map((i, idx) => {
        const card = <PostCard key={i.post.hash} post={i.post} reason={i.reason} feedId={feed.id > 0 ? feed.id : 0} />;
        const slot = (idx + 1) % MARKET_EVERY === 0 ? marketsForFeed[(idx + 1) / MARKET_EVERY - 1] : undefined;
        return slot ? (
          <Fragment key={i.post.hash}>
            {card}
            <div className="border-b border-line px-4 py-3">
              <MarketCard m={slot} inFeed />
            </div>
          </Fragment>
        ) : (
          card
        );
      })}
      {/* short feeds still surface a market at the end */}
      {res.items.length > 0 && res.items.length < MARKET_EVERY && marketsForFeed[0] && (
        <div className="border-b border-line px-4 py-3">
          <MarketCard m={marketsForFeed[0]} inFeed />
        </div>
      )}
    </div>
  );
}

export function FeedSkeleton() {
  return (
    <div>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex gap-3 border-b border-line px-4 py-4">
          <div className="h-10 w-10 animate-pulse rounded-full bg-panel-2" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-32 animate-pulse rounded bg-panel-2" />
            <div className="h-3 w-full animate-pulse rounded bg-panel-2" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-panel-2" />
          </div>
        </div>
      ))}
    </div>
  );
}
