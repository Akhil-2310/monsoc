import { keccak256, toBytes, type Hex } from "viem";
import type { PostView } from "./types";
import { canonicalize } from "./message";

/** Protocol bounds for the discovery slot share (mirrors FeedRegistry defaults). */
export const DISCOVERY_MIN = 0.05;
export const DISCOVERY_MAX = 0.3;

/**
 * A rule-based feed: a small JSON document any client runs locally.
 * Example: "posts tagged #ai from people I follow, replies weighted 2x, no engagement bait, 15% discovery".
 */
export interface FeedDefinition {
  version: 1;
  name: string;
  description?: string;
  sources: {
    following?: boolean;
    topics?: string[];
    communities?: number[];
    everyone?: boolean;
  };
  filters?: {
    includeTags?: string[]; // require at least one
    excludeTags?: string[];
    excludeLabels?: string[]; // e.g. ["spam", "engagement-bait", "nsfw"]
    maxLinks?: number;
    languages?: string[];
    minTextLength?: number;
    includeReplies?: boolean;
  };
  weights?: {
    likes?: number;
    replies?: number;
    reposts?: number;
    backs?: number;
    /** bonus per level of back-and-forth conversation */
    conversationDepth?: number;
    /** score halves every N hours */
    recencyHalfLifeHours?: number;
    /** 0..1, multiplies by author reputation */
    reputation?: number;
  };
  sort?: "score" | "recent";
  /** share of positions for creators the viewer doesn't follow, within [DISCOVERY_MIN, DISCOVERY_MAX] */
  discovery: number;
}

export interface RankContext {
  viewerFid: number;
  following: Set<number>;
  now?: number;
  /** labels the viewer's chosen labelers applied, merged into post.labels by the indexer */
  mutedFids?: Set<number>;
}

export type RankReason = "network" | "source" | "discovery" | "trial";

export interface RankedItem {
  post: PostView;
  reason: RankReason;
  score: number;
}

export function feedHash(def: FeedDefinition): Hex {
  return keccak256(toBytes(canonicalize(def)));
}

export function validateFeed(def: FeedDefinition): string[] {
  const errs: string[] = [];
  if (def.version !== 1) errs.push("version must be 1");
  if (!def.name) errs.push("name required");
  if (!def.sources || Object.values(def.sources).every((v) => !v || (Array.isArray(v) && v.length === 0)))
    errs.push("at least one source required");
  if (typeof def.discovery !== "number" || def.discovery < DISCOVERY_MIN || def.discovery > DISCOVERY_MAX)
    errs.push(`discovery must be between ${DISCOVERY_MIN} and ${DISCOVERY_MAX}`);
  return errs;
}

/** Deterministic A/B split: a viewer always sees the same variant of a trial group. */
export function trialVariantFor(viewerFid: number, groupId: string): "A" | "B" {
  const h = keccak256(toBytes(`${viewerFid}:${groupId}`));
  return parseInt(h.slice(-2), 16) % 2 === 0 ? "A" : "B";
}

function passesFilters(def: FeedDefinition, p: PostView): boolean {
  const f = def.filters ?? {};
  if (p.type === "reply" && !f.includeReplies) return false;
  if (f.includeTags?.length && !p.tags.some((t) => f.includeTags!.includes(t))) return false;
  if (f.excludeTags?.length && p.tags.some((t) => f.excludeTags!.includes(t))) return false;
  if (f.excludeLabels?.length && p.labels.some((l) => f.excludeLabels!.includes(l))) return false;
  if (f.maxLinks !== undefined && p.links.length > f.maxLinks) return false;
  if (f.minTextLength && p.text.length < f.minTextLength) return false;
  return true;
}

function matchesTopic(def: FeedDefinition, p: PostView): boolean {
  const s = def.sources;
  if (s.everyone) return true;
  if (s.topics?.length && p.tags.some((t) => s.topics!.includes(t))) return true;
  if (s.communities?.length && p.community !== null && s.communities.includes(p.community)) return true;
  return false;
}

export function scorePost(def: FeedDefinition, p: PostView, now: number): number {
  if (def.sort === "recent") return p.timestamp;
  const w = def.weights ?? {};
  const engagement =
    1 +
    (w.likes ?? 1) * p.stats.likes +
    (w.replies ?? 1) * p.stats.replies +
    (w.reposts ?? 1) * p.stats.reposts +
    (w.backs ?? 1) * p.stats.backs +
    (w.conversationDepth ?? 0) * p.stats.depth;
  const ageH = Math.max(0, now - p.timestamp) / 3_600_000;
  const halfLife = w.recencyHalfLifeHours ?? 12;
  const decay = Math.pow(0.5, ageH / halfLife);
  const rep = 1 - (w.reputation ?? 0) + (w.reputation ?? 0) * p.authorReputation;
  return Math.log2(1 + engagement) * decay * rep;
}

/**
 * Rank candidates for a viewer. In-network/source posts fill the main list; every k-th position is a
 * discovery slot reserved for creators the viewer doesn't follow (within the feed's topics). Trial
 * posts only ever appear in discovery slots, and only to non-followers.
 */
export function rankFeed(def: FeedDefinition, candidates: PostView[], ctx: RankContext, limit = 50): RankedItem[] {
  const now = ctx.now ?? Date.now();
  const seen = new Set<Hex>();
  const main: RankedItem[] = [];
  const discovery: RankedItem[] = [];
  const trialGroupsSeen = new Set<string>();

  for (const p of candidates) {
    if (seen.has(p.hash)) continue;
    seen.add(p.hash);
    if (ctx.mutedFids?.has(p.fid)) continue;
    if (!passesFilters(def, p)) continue;

    // your own posts rank like people you follow; your unreleased trials live on the Trials page
    const own = p.fid === ctx.viewerFid;
    if (own && p.trial?.status === "testing") continue;
    const follows = own || ctx.following.has(p.fid);
    const isTesting = p.trial?.status === "testing";
    if (p.trial?.status === "dropped") continue;

    if (isTesting) {
      if (follows) continue; // trials are for strangers first
      if (!p.tags.some((t) => p.trial!.topics.includes(t)) || !matchesTopic(def, p)) continue;
      const g = p.trial!.groupId;
      if (g && p.trial!.variant) {
        if (trialVariantFor(ctx.viewerFid, g) !== p.trial!.variant || trialGroupsSeen.has(g)) continue;
        trialGroupsSeen.add(g);
      }
      discovery.push({ post: p, reason: "trial", score: scorePost(def, p, now) * 1.25 });
      continue;
    }

    const topical = matchesTopic(def, p);
    if (follows && (def.sources.following || topical)) {
      main.push({ post: p, reason: "network", score: scorePost(def, p, now) });
    } else if (!follows && topical) {
      // In a follow-based feed, strangers compete for discovery slots. In a pure topic/community
      // feed, strangers are the main content (that's what a topic feed is).
      const score = scorePost(def, p, now);
      if (def.sources.following) discovery.push({ post: p, reason: "discovery", score });
      else main.push({ post: p, reason: "source", score });
    }
  }

  main.sort((a, b) => b.score - a.score);
  discovery.sort((a, b) => b.score - a.score);

  // Topic-only feeds: everything is non-followed, so carve discovery from new/small creators instead.
  if (!def.sources.following && discovery.length < limit * def.discovery) {
    const small = main.filter((i) => i.reason === "source" && i.post.authorFollowers < 100);
    for (const i of small.slice(0, Math.ceil(limit * def.discovery) - discovery.length)) {
      main.splice(main.indexOf(i), 1);
      discovery.push({ ...i, reason: "discovery" });
    }
  }

  return interleave(main, discovery, def.discovery, limit);
}

/** Place a discovery item every round(1/share) positions; leftovers backfill either way. */
export function interleave(main: RankedItem[], discovery: RankedItem[], share: number, limit: number): RankedItem[] {
  const out: RankedItem[] = [];
  const every = Math.max(2, Math.round(1 / Math.max(share, 0.01)));
  let mi = 0;
  let di = 0;
  while (out.length < limit && (mi < main.length || di < discovery.length)) {
    const slot = (out.length + 1) % every === 0;
    if ((slot && di < discovery.length) || mi >= main.length) out.push(discovery[di++]!);
    else out.push(main[mi++]!);
  }
  return out;
}

// ------------------------------------------------------------------ built-in feeds

export const DEFAULT_FEEDS: Record<string, FeedDefinition> = {
  home: {
    version: 1,
    name: "Home",
    description: "People you follow, ranked by conversation, with 15% discovery.",
    sources: { following: true, everyone: true },
    filters: { excludeLabels: ["spam", "engagement-bait", "nsfw"] },
    weights: { likes: 1, replies: 2, reposts: 1.5, backs: 1, conversationDepth: 1, recencyHalfLifeHours: 10, reputation: 0.5 },
    discovery: 0.15,
  },
  conversations: {
    version: 1,
    name: "Real conversations",
    description: "Rewards back-and-forth replies, not raw likes.",
    sources: { following: true, everyone: true },
    filters: { excludeLabels: ["spam", "engagement-bait"], maxLinks: 1 },
    weights: { likes: 0.2, replies: 3, reposts: 0.5, conversationDepth: 3, recencyHalfLifeHours: 24 },
    discovery: 0.15,
  },
  noBait: {
    version: 1,
    name: "No engagement bait",
    description: "Filters bait, giveaways and link spam; recency first.",
    sources: { following: true, everyone: true },
    filters: { excludeLabels: ["spam", "engagement-bait", "giveaway"], maxLinks: 1, minTextLength: 20 },
    sort: "recent",
    discovery: 0.1,
  },
  ai: {
    version: 1,
    name: "AI builders",
    description: "Posts tagged #ai, replies weighted 2x, 20% discovery.",
    sources: { topics: ["ai"] },
    filters: { includeTags: ["ai"], excludeLabels: ["spam", "engagement-bait"] },
    weights: { likes: 1, replies: 2, reposts: 1, recencyHalfLifeHours: 18 },
    discovery: 0.2,
  },
};
