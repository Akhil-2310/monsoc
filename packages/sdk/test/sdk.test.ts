import { describe, it, expect } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import {
  MessageBuilder,
  verifyMessage,
  canonicalize,
  rankFeed,
  DEFAULT_FEEDS,
  trialVariantFor,
  computeScoutScores,
  allocatePayouts,
  anchorTree,
  validateProfile,
  topicsOf,
  topicFeed,
  cleanProfile,
  type PostView,
  type FeedDefinition,
} from "../src";

let n = 0;
function post(p: Partial<PostView> & { fid: number }): PostView {
  n++;
  return {
    hash: `0x${n.toString(16).padStart(64, "0")}` as Hex,
    handle: null,
    displayName: null,
    avatar: null,
    type: "post",
    timestamp: Date.now() - n * 60_000,
    text: "hello world, a reasonably long post",
    tags: [],
    links: [],
    media: [],
    community: null,
    parent: null,
    market: null,
    labels: [],
    trial: null,
    stats: { likes: 0, replies: 0, reposts: 0, backs: 0, views: 0, depth: 0 },
    authorFollowers: 10,
    authorReputation: 0.8,
    anchored: false,
    ...p,
  };
}

describe("messages", () => {
  it("signs and verifies; tampering breaks it", async () => {
    const b = new MessageBuilder(privateKeyToAccount(generatePrivateKey()), 7);
    const m = await b.build("post", { text: "gm #monad", tags: ["monad"] });
    expect(m.data.seq).toBe(1);
    expect(await verifyMessage(m)).toBe(true);
    const tampered = { ...m, data: { ...m.data, body: { text: "gn" } } };
    expect(await verifyMessage(tampered as typeof m)).toBe(false);
  });

  it("canonicalizes key order", () => {
    expect(canonicalize({ b: 1, a: [{ d: 2, c: undefined }] })).toBe('{"a":[{"d":2}],"b":1}');
  });
});

describe("feed engine", () => {
  const viewer = 1;
  const following = new Set([2, 3]);

  it("reserves discovery slots for non-followed creators", () => {
    const posts = [
      ...Array.from({ length: 12 }, () => post({ fid: 2 })),
      ...Array.from({ length: 6 }, () => post({ fid: 9 })),
    ];
    const ranked = rankFeed(DEFAULT_FEEDS.home!, posts, { viewerFid: viewer, following }, 14);
    const disc = ranked.filter((r) => r.reason === "discovery");
    expect(disc.length).toBeGreaterThanOrEqual(2);
    expect(ranked[6]!.reason).toBe("discovery"); // every round(1/0.15)=7th slot
  });

  it("never shows trials to followers, shows them to strangers in discovery", () => {
    const trial = post({
      fid: 3,
      tags: ["ai"],
      trial: { topics: ["ai"], status: "testing" },
    });
    const strangerTrial = post({ fid: 8, tags: ["ai"], trial: { topics: ["ai"], status: "testing" } });
    const ranked = rankFeed(DEFAULT_FEEDS.home!, [trial, strangerTrial, post({ fid: 2 })], { viewerFid: viewer, following });
    expect(ranked.map((r) => r.post.hash)).not.toContain(trial.hash);
    expect(ranked.find((r) => r.post.hash === strangerTrial.hash)?.reason).toBe("trial");
  });

  it("shows one A/B variant per viewer, deterministically", () => {
    const a = post({ fid: 8, tags: ["ai"], trial: { topics: ["ai"], groupId: "g1", variant: "A", status: "testing" } });
    const b = post({ fid: 8, tags: ["ai"], trial: { topics: ["ai"], groupId: "g1", variant: "B", status: "testing" } });
    const ranked = rankFeed(DEFAULT_FEEDS.ai!, [a, b], { viewerFid: 42, following: new Set() });
    expect(ranked).toHaveLength(1);
    expect(ranked[0]!.post.trial!.variant).toBe(trialVariantFor(42, "g1"));
  });

  it("never labels followed authors as discovery in topic feeds", () => {
    const posts = [post({ fid: 2, tags: ["ai"] }), post({ fid: 3, tags: ["ai"] }), post({ fid: 9, tags: ["ai"] })];
    const ranked = rankFeed(DEFAULT_FEEDS.ai!, posts, { viewerFid: viewer, following });
    for (const r of ranked) if (following.has(r.post.fid)) expect(r.reason).toBe("network");
    expect(ranked.find((r) => r.post.fid === 9)?.reason).toBe("discovery");
  });

  it("shows the viewer's own posts but not their running trials", () => {
    const mine = post({ fid: viewer });
    const myTrial = post({ fid: viewer, tags: ["ai"], trial: { topics: ["ai"], status: "testing" } });
    const ranked = rankFeed(DEFAULT_FEEDS.home!, [mine, myTrial], { viewerFid: viewer, following });
    expect(ranked.map((r) => r.post.hash)).toEqual([mine.hash]);
    expect(ranked[0]!.reason).toBe("network");
  });

  it("applies filters and labels", () => {
    const def: FeedDefinition = { ...DEFAULT_FEEDS.noBait! };
    const bait = post({ fid: 2, labels: ["engagement-bait"] });
    const links = post({ fid: 2, links: ["https://a", "https://b"] });
    const ok = post({ fid: 2 });
    const ranked = rankFeed(def, [bait, links, ok], { viewerFid: viewer, following });
    expect(ranked.map((r) => r.post.hash)).toEqual([ok.hash]);
  });

  it("weights replies over likes in the conversations feed", () => {
    const liked = post({ fid: 2, stats: { likes: 20, replies: 0, reposts: 0, backs: 0, views: 0, depth: 0 } });
    const talked = post({ fid: 2, stats: { likes: 1, replies: 6, reposts: 0, backs: 0, views: 0, depth: 3 } });
    const ranked = rankFeed(DEFAULT_FEEDS.conversations!, [liked, talked], { viewerFid: viewer, following });
    expect(ranked[0]!.post.hash).toBe(talked.hash);
  });
});

describe("scouts", () => {
  it("rewards backing early over backing late", () => {
    const day = 86_400_000;
    const scores = computeScoutScores({
      backings: [
        { scout: 10, creator: 99, at: 1 * day },
        { scout: 11, creator: 99, at: 5 * day },
      ],
      verifiedFollowersAt: (_c, at) => (at < 2 * day ? 200 : 15_000),
      verifiedFollowersNow: () => 20_000,
      reputationOf: () => 1,
    });
    const early = scores.find((s) => s.fid === 10)!;
    const late = scores.find((s) => s.fid === 11)!;
    expect(early.score).toBeGreaterThan(late.score * 10);
  });

  it("filters low-reputation scouts", () => {
    const scores = computeScoutScores({
      backings: [{ scout: 10, creator: 99, at: 0 }],
      verifiedFollowersAt: () => 0,
      verifiedFollowersNow: () => 100,
      reputationOf: () => 0.1,
    });
    expect(scores).toHaveLength(0);
  });
});

describe("payouts", () => {
  it("splits each subscriber's creator share by their own engagement", () => {
    const alloc = allocatePayouts(
      [{ subscriberFid: 1, feedId: 5, token: "0xT", toCreators: 1_000_000n }],
      [
        { subscriberFid: 1, feedId: 5, creatorFid: 7, views: 3, likes: 0, replies: 0 },
        { subscriberFid: 1, feedId: 5, creatorFid: 8, views: 0, likes: 1, replies: 0 },
        { subscriberFid: 2, feedId: 5, creatorFid: 9, views: 100, likes: 0, replies: 0 }, // not a payer
      ],
      { reputationOf: () => 1 },
    );
    expect(alloc).toEqual([
      { fid: 7, token: "0xT", amount: 500_000n },
      { fid: 8, token: "0xT", amount: 500_000n },
    ]);
  });
});

describe("merkle", () => {
  it("builds verifiable anchor proofs", () => {
    const hashes = [1, 2, 3].map((i) => `0x${i.toString(16).padStart(64, "0")}` as Hex);
    const t = anchorTree(hashes);
    expect(t.verify(1, t.getProof(1))).toBe(true);
  });
});

describe("profiles", () => {
  it("accepts good profiles and rejects bad links and long fields", () => {
    expect(validateProfile({ displayName: "Akhil", bio: "building", avatar: "ipfs://bafyabc", url: "https://x.dev" })).toEqual([]);
    expect(validateProfile({ url: "javascript:alert(1)" })).toHaveLength(1);
    expect(validateProfile({ avatar: "http://insecure.png" })).toHaveLength(1);
    expect(validateProfile({ bio: "x".repeat(281) })).toHaveLength(1);
    expect(validateProfile({ evil: "1" } as never)).toHaveLength(1);
  });
  it("cleans empty fields", () => {
    expect(cleanProfile({ displayName: "  A  ", bio: "", url: " " })).toEqual({ displayName: "A" });
  });
});

describe("topics", () => {
  it("maps related tags to topics", () => {
    expect(topicsOf(["IPL", "monad"])).toEqual(["sports", "crypto"]);
    expect(topicsOf(["random"])).toEqual([]);
  });
  it("topic feeds pull in related tags", () => {
    const ranked = rankFeed(topicFeed("sports"), [post({ fid: 9, tags: ["cricket"] }), post({ fid: 9, tags: ["ai"] })], {
      viewerFid: 1,
      following: new Set(),
    });
    expect(ranked).toHaveLength(1);
    expect(ranked[0]!.post.tags).toEqual(["cricket"]);
  });
});
