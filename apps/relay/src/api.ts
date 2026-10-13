import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { erc20Abi, getAddress, isAddress, type Address, type Hex } from "viem";
import {
  paymentsAbi,
  forwarderAbi,
  signupAbi,
  NATIVE,
  type CommunityInfo,
  type FeedInfo,
  type SignedMessage,
} from "@monsoc/sdk";
import { config } from "./config";
import { all, get, kvGet } from "./db";
import { deployment, publicClient, relayAccount } from "./chain";
import { bus, ingest, RejectError } from "./messages";
import { profile, profiles, queryPosts, postsByHash, handleOf, defaultLabelers } from "./views";
import { proofFor, batchHashes } from "./anchor";
import { forward, signup, faucet } from "./sponsor";
import { trialResults, scoutScoresFor, currentEpoch } from "./jobs";

export const app = new Hono();
app.use("*", cors());

app.onError((err, c) => {
  const status = err instanceof RejectError ? 400 : 500;
  if (status === 500) console.error("[api]", err);
  return c.json({ error: err.message }, status);
});

const fidParam = (v: string | undefined) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new RejectError("bad fid");
  return n;
};
const labelersFrom = (q: string | undefined) => (q ? q.split(",").map(Number).filter(Boolean) : undefined);

// ------------------------------------------------------------------ writes

app.post("/v1/messages", async (c) => c.json(await ingest(await c.req.json<SignedMessage>(), { source: "client" })));

/** Relay sync: other relays pull everything after a cursor. Messages are signed and order-independent. */
app.get("/v1/messages", (c) => {
  const since = Number(c.req.query("since") ?? 0);
  const limit = Math.min(1000, Number(c.req.query("limit") ?? 500));
  const rows = all<{ relay_seq: number; raw: string }>(
    "SELECT relay_seq, raw FROM messages WHERE relay_seq > ? ORDER BY relay_seq LIMIT ?",
    since,
    limit,
  );
  return c.json({ messages: rows.map((r) => JSON.parse(r.raw)), next: rows.at(-1)?.relay_seq ?? since });
});

app.post("/v1/sponsor/signup", async (c) => {
  const { params, signature } = await c.req.json();
  return c.json(await signup(params, signature));
});
app.post("/v1/sponsor/forward", async (c) => {
  const { request } = await c.req.json();
  return c.json(await forward(request));
});
app.get("/v1/sponsor/nonce/:address", async (c) => {
  const nonce = await publicClient.readContract({
    address: deployment.forwarder,
    abi: forwarderAbi,
    functionName: "nonces",
    args: [c.req.param("address") as Address],
  });
  return c.json({ nonce: nonce.toString() });
});
app.get("/v1/sponsor/signup-nonce/:address", async (c) => {
  const nonce = await publicClient.readContract({
    address: deployment.signup,
    abi: signupAbi,
    functionName: "nonces",
    args: [c.req.param("address") as Address],
  });
  return c.json({ nonce: nonce.toString() });
});
app.post("/v1/faucet", async (c) => {
  const { address } = await c.req.json();
  if (!isAddress(address)) throw new RejectError("bad address");
  return c.json(await faucet(address));
});

// ------------------------------------------------------------------ info

app.get("/v1/info", async (c) =>
  c.json({ chainId: config.chainId, deployment, relay: relayAccount.address, epoch: await currentEpoch().catch(() => 0) }),
);

// ------------------------------------------------------------------ users

app.get("/v1/users/:id", (c) => {
  const p = profile(c.req.param("id"));
  return p ? c.json(p) : c.json({ error: "not found" }, 404);
});
app.get("/v1/custody/:address", (c) => {
  const row = get<{ fid: number }>("SELECT fid FROM users WHERE custody = ?", c.req.param("address").toLowerCase());
  return c.json(row ? profile(row.fid) : null);
});
app.get("/v1/users/:fid/followers", (c) =>
  c.json(profiles("u.fid IN (SELECT fid FROM follows WHERE target = ?)", [fidParam(c.req.param("fid"))])),
);
app.get("/v1/users/:fid/following", (c) =>
  c.json(profiles("u.fid IN (SELECT target FROM follows WHERE fid = ?)", [fidParam(c.req.param("fid"))])),
);
app.get("/v1/users/:fid/posts", (c) =>
  c.json(queryPosts("p.fid = ?", [fidParam(c.req.param("fid"))], { limit: 100, labelers: labelersFrom(c.req.query("labelers")) })),
);
app.get("/v1/users/:fid/subscriptions", (c) =>
  c.json(
    all<{ feedId: number; until: number }>(
      "SELECT feed_id AS feedId, until FROM subscriptions WHERE fid = ? AND until > ?",
      fidParam(c.req.param("fid")),
      Date.now(),
    ),
  ),
);
app.get("/v1/users/:fid/communities", (c) =>
  c.json(
    all(
      "SELECT community_id AS communityId, role FROM members WHERE fid = ? AND role > 0 AND banned = 0 AND (expires_at = 0 OR expires_at > ?)",
      fidParam(c.req.param("fid")),
      Date.now(),
    ),
  ),
);
app.get("/v1/users/:fid/trials", (c) => {
  const fid = fidParam(c.req.param("fid"));
  const rows = all<{ hash: Hex; trial_group: string | null }>(
    "SELECT hash, trial_group FROM posts WHERE fid = ? AND trial IS NOT NULL AND deleted = 0 ORDER BY ts DESC LIMIT 50",
    fid,
  );
  const seen = new Set<string>();
  const out = [];
  for (const r of rows) {
    const k = r.trial_group ?? r.hash;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(trialResults(r.hash));
  }
  return c.json(out);
});
app.get("/v1/users/:fid/backs", (c) => {
  const fid = fidParam(c.req.param("fid"));
  const s = get<{ top: string }>("SELECT top FROM scout_scores WHERE fid = ?", fid);
  const finds = new Map(
    (s ? (JSON.parse(s.top) as { creator: number; from: number; now: number }[]) : []).map((f) => [f.creator, f]),
  );
  const rows = all<{ creator: number; at: number }>(
    `SELECT creator, MIN(ts) AS at FROM (SELECT creator, ts FROM backs WHERE fid = ? UNION ALL SELECT target, ts FROM follows WHERE fid = ?)
     GROUP BY creator ORDER BY at DESC LIMIT 100`,
    fid,
    fid,
  );
  const verifiedNow = (cr: number) => get<{ v: number }>("SELECT verified_followers AS v FROM reputation WHERE fid = ?", cr)?.v ?? 0;
  return c.json(
    rows.map((r) => ({
      creator: r.creator,
      handle: handleOf(r.creator),
      at: r.at,
      from: finds.get(r.creator)?.from ?? null,
      now: finds.get(r.creator)?.now ?? verifiedNow(r.creator),
    })),
  );
});
app.get("/v1/users/:fid/balances", async (c) => {
  const fid = BigInt(fidParam(c.req.param("fid")));
  const tokens: [Address, string][] = [
    [deployment.tusd, "tUSD"],
    [NATIVE, "MON"],
  ];
  const out = await Promise.all(
    tokens.map(async ([token, symbol]) => ({
      token,
      symbol,
      claimable: (
        await publicClient.readContract({ address: deployment.payments, abi: paymentsAbi, functionName: "balanceOf", args: [fid, token] })
      ).toString(),
    })),
  );
  return c.json(out);
});
app.get("/v1/users/:fid/payouts", (c) =>
  c.json(
    all<{ epoch: number; token: string; amount: string; proof: string; claimed: number }>(
      "SELECT epoch, token, amount, proof, claimed FROM payout_leaves WHERE fid = ? ORDER BY epoch DESC",
      fidParam(c.req.param("fid")),
    ).map((r) => ({ ...r, token: r.token === NATIVE ? NATIVE : getAddress(r.token), proof: JSON.parse(r.proof), claimed: !!r.claimed })),
  ),
);

// ------------------------------------------------------------------ posts + feeds inputs

/** Candidate posts for client-side ranking. Rule-based feeds run on the client over this set. */
app.get("/v1/feed-inputs", (c) => {
  const fid = Number(c.req.query("fid") ?? 0);
  const limit = Math.min(500, Number(c.req.query("limit") ?? 300));
  const topics = (c.req.query("topics") ?? "").split(",").filter(Boolean).map((t) => t.toLowerCase());
  const community = Number(c.req.query("community") ?? 0);
  const labelers = labelersFrom(c.req.query("labelers"));
  const following = all<{ target: number }>("SELECT target FROM follows WHERE fid = ?", fid).map((r) => r.target);

  let posts;
  if (community) {
    posts = queryPosts("p.community = ? AND p.type != 'reply'", [community], { limit, labelers });
  } else if (topics.length) {
    posts = queryPosts(
      `p.type != 'reply' AND p.hash IN (SELECT hash FROM post_tags WHERE tag IN (${topics.map(() => "?").join(",")}))`,
      topics,
      { limit, labelers },
    );
  } else {
    const net = queryPosts("p.type != 'reply' AND p.fid IN (SELECT target FROM follows WHERE fid = ?)", [fid], { limit: 200, labelers });
    const global = queryPosts("p.type != 'reply'", [], { limit, labelers });
    posts = [...net, ...global];
  }
  return c.json({ following, posts });
});

app.post("/v1/posts/batch", async (c) => {
  const { hashes, labelers } = await c.req.json<{ hashes: string[]; labelers?: number[] }>();
  return c.json(postsByHash(hashes.slice(0, 200), labelers));
});

app.get("/v1/threads/:hash", (c) => {
  const hash = c.req.param("hash");
  const [root] = postsByHash([hash]);
  if (!root) return c.json({ error: "not found" }, 404);
  const replies = queryPosts("p.root = ? OR p.parent = ?", [hash, hash], { order: "p.ts ASC", limit: 500 });
  return c.json({ root, replies });
});

app.get("/v1/proofs/:hash", (c) => {
  const p = proofFor(c.req.param("hash") as Hex);
  return p ? c.json(p) : c.json({ error: "not found" }, 404);
});
app.get("/v1/batches/by-root/:root", (c) => {
  const b = get<{ id: number; root: string; count: number; tx: string }>("SELECT * FROM batches WHERE root = ?", c.req.param("root"));
  if (!b) return c.json({ error: "not found" }, 404);
  const hashes = batchHashes(b.id);
  const raw = all<{ raw: string }>("SELECT raw FROM messages WHERE anchor_batch = ? ORDER BY relay_seq", b.id).map((r) => JSON.parse(r.raw));
  return c.json({ ...b, hashes, messages: raw });
});

// ------------------------------------------------------------------ feeds

interface FeedRow {
  id: number;
  owner_fid: number;
  kind: number;
  uri: string;
  def_hash: Hex;
  version: number;
  price_usd: number;
  creator_share_bps: number;
  discovery_bps: number;
  active: number;
  meta: string | null;
  subs: number;
}

function toFeed(r: FeedRow): FeedInfo {
  const meta = (r.meta ? JSON.parse(r.meta) : null) ?? {};
  return {
    id: r.id,
    ownerFid: r.owner_fid,
    ownerHandle: handleOf(r.owner_fid),
    kind: r.kind === 0 ? "rule" : "hosted",
    name: meta.name ?? `Feed #${r.id}`,
    description: meta.description ?? "",
    uri: r.uri,
    defHash: r.def_hash,
    version: r.version,
    priceUsd: r.price_usd,
    creatorShareBps: r.creator_share_bps,
    discoveryBps: r.discovery_bps,
    active: !!r.active,
    definition: meta.definition ?? null,
    endpoint: meta.endpoint ?? null,
    subscribers: r.subs,
  };
}

const FEED_SELECT = `SELECT f.*, (SELECT COUNT(*) FROM subscriptions s WHERE s.feed_id = f.id AND s.until > ${"?"}) AS subs FROM feeds f`;

app.get("/v1/feeds", (c) => c.json(all<FeedRow>(`${FEED_SELECT} WHERE f.active = 1 ORDER BY subs DESC, f.id`, Date.now()).map(toFeed)));
app.get("/v1/feeds/:id", (c) => {
  const r = get<FeedRow>(`${FEED_SELECT} WHERE f.id = ?`, Date.now(), Number(c.req.param("id")));
  if (!r) return c.json({ error: "not found" }, 404);
  const versions = all("SELECT version, uri, def_hash AS defHash, at FROM feed_versions WHERE feed_id = ? ORDER BY version DESC", r.id);
  return c.json({ ...toFeed(r), versions });
});

// ------------------------------------------------------------------ communities

interface CommunityRow {
  id: number;
  owner_fid: number;
  join_type: number;
  gate_token: string | null;
  gate_min: string;
  price_usd: number;
  period: number;
  feed_id: number;
  meta: string | null;
  member_count: number;
}
const JOIN = ["open", "token", "invite", "paid"] as const;

function toCommunity(r: CommunityRow): CommunityInfo {
  const meta = (r.meta ? JSON.parse(r.meta) : null) ?? {};
  return {
    id: r.id,
    ownerFid: r.owner_fid,
    name: meta.name ?? `Community #${r.id}`,
    description: meta.description ?? "",
    rules: meta.rules ?? [],
    joinType: JOIN[r.join_type] ?? "open",
    gateToken: r.gate_token && r.gate_token !== NATIVE ? (getAddress(r.gate_token) as Address) : null,
    gateMin: r.gate_min,
    priceUsd: r.price_usd,
    period: r.period,
    feedId: r.feed_id,
    memberCount: r.member_count,
    rooms: meta.rooms ?? ["general"],
    tags: meta.tags ?? [],
  };
}
const COMMUNITY_SELECT = `SELECT c.*, (SELECT COUNT(*) FROM members m WHERE m.community_id = c.id AND m.role > 0 AND m.banned = 0) AS member_count FROM communities c`;

app.get("/v1/communities", (c) => c.json(all<CommunityRow>(`${COMMUNITY_SELECT} ORDER BY member_count DESC`).map(toCommunity)));
app.get("/v1/communities/:id", (c) => {
  const id = Number(c.req.param("id"));
  const r = get<CommunityRow>(`${COMMUNITY_SELECT} WHERE c.id = ?`, id);
  if (!r) return c.json({ error: "not found" }, 404);
  const roles = new Map(all<{ fid: number; role: number }>("SELECT fid, role FROM members WHERE community_id = ? AND role > 0 AND banned = 0", id).map((m) => [m.fid, m.role]));
  const members = profiles(`u.fid IN (${[...roles.keys()].join(",") || 0})`, [], "followers DESC", 200).map((p) => ({ ...p, role: roles.get(p.fid)! }));
  return c.json({ ...toCommunity(r), members });
});
app.get("/v1/chat/:community/:room", (c) => {
  const rows = all<{ raw: string }>(
    "SELECT raw FROM chat WHERE community = ? AND room = ? AND ts > ? ORDER BY ts DESC LIMIT 200",
    Number(c.req.param("community")),
    c.req.param("room"),
    Number(c.req.query("since") ?? 0),
  );
  return c.json(rows.map((r) => JSON.parse(r.raw)).reverse());
});

// ------------------------------------------------------------------ trials + scouts

app.get("/v1/trials/:hash", (c) => {
  const r = trialResults(c.req.param("hash") as Hex);
  return r ? c.json(r) : c.json({ error: "not found" }, 404);
});

app.get("/v1/scouts", (c) => {
  const topic = c.req.query("topic");
  const scores = topic
    ? scoutScoresFor(topic)
    : all<{ fid: number; score: number; backed: number; hits: number; top: string }>("SELECT * FROM scout_scores ORDER BY score DESC LIMIT 100").map(
        (s) => ({ fid: s.fid, score: s.score, backed: s.backed, hits: s.hits, topFinds: JSON.parse(s.top) }),
      );
  return c.json(
    scores
      .filter((s) => s.score > 0)
      .slice(0, 50)
      .map((s) => ({
        ...profile(s.fid)!,
        score: s.score,
        hits: s.hits,
        backed: s.backed,
        topFinds: s.topFinds.map((f: { creator: number; from: number; now: number }) => ({ ...f, handle: handleOf(f.creator) })),
      })),
  );
});

// ------------------------------------------------------------------ onboarding (cold start)

app.get("/v1/onboarding/:address", async (c) => {
  const address = c.req.param("address") as Address;
  const all_ = all<CommunityRow>(`${COMMUNITY_SELECT} ORDER BY member_count DESC`);
  const gated = all_.filter((r) => r.gate_token && r.gate_token !== NATIVE);
  const tokenNames = new Map<string, string>();
  const held = new Set<string>();
  await Promise.all(
    [...new Set(gated.map((g) => g.gate_token!))].map(async (token) => {
      try {
        const [bal, sym] = await Promise.all([
          publicClient.readContract({ address: token as Address, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
          publicClient.readContract({ address: token as Address, abi: erc20Abi, functionName: "symbol" }).catch(() => "NFT"),
        ]);
        tokenNames.set(token, sym);
        if (bal > 0n) held.add(token);
      } catch {}
    }),
  );
  const communities = [
    ...gated
      .filter((g) => held.has(g.gate_token!))
      .map((g) => ({ ...toCommunity(g), reason: `You hold ${tokenNames.get(g.gate_token!) ?? "the token"}` })),
    ...all_
      .filter((r) => r.join_type === 0)
      .slice(0, 6)
      .map((r) => ({ ...toCommunity(r), reason: `${r.member_count} members, active now` })),
  ];
  const cids = communities.map((c) => c.id);
  const people = profiles(
    `u.fid IN (SELECT p.fid FROM posts p WHERE p.community IN (${cids.join(",") || 0}) GROUP BY p.fid ORDER BY COUNT(*) DESC LIMIT 12)
     OR u.fid IN (SELECT fid FROM users ORDER BY (SELECT COUNT(*) FROM follows f WHERE f.target = users.fid) DESC LIMIT 8)`,
    [],
    "followers DESC",
    12,
  ).map((p) => ({ ...p, reason: p.followers > 3 ? `${p.followers} followers` : "Active in your communities" }));
  const starterPacks = JSON.parse(kvGet("starter_packs") ?? "[]");
  return c.json({ communities, people, starterPacks });
});

app.get("/v1/labelers", (c) =>
  c.json(
    defaultLabelers().map((fid) => ({
      fid,
      handle: handleOf(fid),
      name: "Default labeler",
      description: "Spam, scams, giveaways and engagement bait. Run by the relay operator; clients may choose others.",
    })),
  ),
);

// ------------------------------------------------------------------ realtime

app.get("/v1/stream", (c) =>
  streamSSE(c, async (stream) => {
    const onMsg = (m: SignedMessage) => {
      if (m.data.type === "view") return;
      stream.writeSSE({ data: JSON.stringify(m) }).catch(() => undefined);
    };
    bus.on("message", onMsg);
    stream.onAbort(() => {
      bus.off("message", onMsg);
    });
    while (!stream.aborted) {
      await stream.writeSSE({ event: "ping", data: String(Date.now()) });
      await stream.sleep(15_000);
    }
  }),
);

// ------------------------------------------------------------------ example hosted feed

/**
 * A hosted feed is just a server returning ranked post ids. This one ("High signal") ranks posts by
 * reputable authors with real conversation. Anyone can run their own and register it in FeedRegistry.
 */
app.get("/hosted/high-signal", (c) => {
  const fid = Number(c.req.query("fid") ?? 0);
  const posts = queryPosts("p.type != 'reply' AND p.trial_status IS NOT 'testing'", [], { limit: 400 })
    .filter((p) => p.authorReputation >= 0.5 && p.fid !== fid && !p.labels.some((l) => ["spam", "engagement-bait", "giveaway", "scam"].includes(l)))
    .map((p) => {
      const ageH = (Date.now() - p.timestamp) / 3_600_000;
      const s = (1 + 3 * p.stats.replies + 2 * p.stats.depth + p.stats.likes + 2 * p.stats.backs) * Math.pow(0.5, ageH / 24) * p.authorReputation;
      return { hash: p.hash, s };
    })
    .sort((a, b) => b.s - a.s)
    .slice(0, 60);
  return c.json({ items: posts.map((p) => ({ hash: p.hash, reason: "high-signal" })) });
});
