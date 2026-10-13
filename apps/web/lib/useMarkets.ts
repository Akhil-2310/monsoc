"use client";
import { useEffect, useState } from "react";
import type { MarketInfo } from "@monsoc/sdk";
import { relay } from "./session";
import cfg from "@/monsoc.config";

// One shared cache of live markets for the whole page: feeds and post chips read it, one fetch every 20s.
let cache: MarketInfo[] = [];
let loadedAt = 0;
let inflight: Promise<void> | null = null;
const listeners = new Set<(m: MarketInfo[]) => void>();

function refresh(force = false) {
  if (!cfg.plugins.markets) return;
  if (!force && (inflight || Date.now() - loadedAt < 20_000)) return;
  inflight = relay
    .markets({ status: "open" })
    .then((m) => {
      cache = m.filter((x) => x.deadline > Date.now());
      loadedAt = Date.now();
      listeners.forEach((l) => l(cache));
    })
    .catch(() => undefined)
    .finally(() => (inflight = null));
}

/** After a stake/claim: the relay indexes the new event ~1-2s after the tx, so refresh then and once more. */
export function refreshMarkets() {
  refresh(true);
  setTimeout(() => refresh(true), 2_000);
  setTimeout(() => refresh(true), 5_000);
}

/** Live markets, newest data first; re-renders when the shared cache updates. */
export function useLiveMarkets(): MarketInfo[] {
  const [m, setM] = useState(cache);
  useEffect(() => {
    listeners.add(setM);
    refresh();
    const t = setInterval(() => refresh(), 20_000);
    return () => {
      listeners.delete(setM);
      clearInterval(t);
    };
  }, []);
  return m;
}

/** The live market on a creator (the one ending soonest), if any. */
export function useCreatorMarket(creatorFid: number): MarketInfo | undefined {
  return useLiveMarkets()
    .filter((m) => m.creator?.fid === creatorFid)
    .sort((a, b) => a.deadline - b.deadline)[0];
}

// Any market by id (open or settled), for markets embedded in posts. Cached per page load.
const byId = new Map<number, Promise<MarketInfo | null>>();

export function useMarket(id: number | null | undefined): MarketInfo | null {
  const live = useLiveMarkets().find((m) => m.id === id) ?? null;
  const [fetched, setFetched] = useState<MarketInfo | null>(null);
  useEffect(() => {
    if (!id || live) return;
    if (!byId.has(id)) byId.set(id, relay.market(id).catch(() => null));
    byId.get(id)!.then(setFetched);
  }, [id, live]);
  return live ?? fetched;
}
