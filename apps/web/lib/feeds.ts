import type { Hex } from "viem";
import { rankFeed, interleave, DEFAULT_FEEDS, DISCOVERY_MIN, type FeedInfo, type RankedItem } from "@monsoc/sdk";
import { relay } from "./session";

/** Built-in fallback when the registry is empty (e.g. a fresh chain before seeding). */
export const BUILTIN_FEEDS: FeedInfo[] = Object.entries(DEFAULT_FEEDS).map(([key, def], i) => ({
  id: -(i + 1),
  ownerFid: 0,
  ownerHandle: null,
  kind: "rule",
  name: def.name,
  description: def.description ?? "",
  uri: `builtin:${key}`,
  defHash: "0x" as Hex,
  version: 1,
  priceUsd: 0,
  creatorShareBps: 0,
  discoveryBps: Math.round(def.discovery * 10_000),
  active: true,
  definition: def,
  endpoint: null,
  subscribers: 0,
}));

export type FeedResult = { items: RankedItem[]; locked?: boolean; noDiscovery?: boolean };

export async function loadFeed(feed: FeedInfo, fid: number, subscribed: boolean, community?: number): Promise<FeedResult> {
  const noDiscovery = feed.discoveryBps < DISCOVERY_MIN * 10_000;
  if (feed.kind === "rule" && feed.definition) {
    const def = feed.definition;
    const topicsOnly = !def.sources.following && !def.sources.everyone && def.sources.topics?.length;
    const inputs = await relay.feedInputs(fid, {
      topics: topicsOnly ? def.sources.topics : undefined,
      community: community ?? (def.sources.communities?.length === 1 ? def.sources.communities[0] : undefined),
    });
    const items = rankFeed(def, inputs.posts, { viewerFid: fid, following: new Set(inputs.following) }, 60);
    return { items, noDiscovery };
  }

  // hosted: the server ranks, the client fills in posts from the indexer
  if (feed.priceUsd > 0 && !subscribed) return { items: [], locked: true };
  if (!feed.endpoint) return { items: [] };
  const [ranked, inputs] = await Promise.all([relay.hostedFeed(feed.endpoint, fid), relay.feedInputs(fid)]);
  const posts = await relay.posts(ranked.items.map((i) => i.hash));
  const main: RankedItem[] = posts.map((p) => ({ post: p, reason: "source", score: 0 }));
  // the default client enforces the protocol discovery slot on hosted feeds too
  const share = Math.max(feed.discoveryBps / 10_000, DISCOVERY_MIN);
  const disc = rankFeed(DEFAULT_FEEDS.home!, inputs.posts, { viewerFid: fid, following: new Set(inputs.following) }, 60).filter(
    (i) => (i.reason === "discovery" || i.reason === "trial") && !posts.some((p) => p.hash === i.post.hash),
  );
  return { items: interleave(main, disc, share, 60), noDiscovery };
}
