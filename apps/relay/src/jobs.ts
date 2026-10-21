import { keccak256, toBytes, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  reputation as computeReputation,
  computeScoutScores,
  allocatePayouts,
  payoutTree,
  scoutTree,
  signMessage,
  paymentsAbi,
  scoutsAbi,
  REPUTATION_VERIFIED,
  NATIVE,
  type Backing,
  type SignedMessage,
  type TrialBody,
  type PostBody,
} from "@monsoc/sdk";
import { config } from "./config";
import { all, get, kvGet, kvSet, run, tx } from "./db";
import { deployment, publicClient, send } from "./chain";
import { bus, ingest } from "./messages";
import { resolveUri } from "./indexer";

// ------------------------------------------------------------------ reputation

export function updateReputation() {
  const users = all<{ fid: number; created_at: number; posts: number; followers: number }>(`
    SELECT u.fid, u.created_at,
      (SELECT COUNT(*) FROM posts p WHERE p.fid = u.fid AND p.deleted = 0) AS posts,
      (SELECT COUNT(*) FROM follows f WHERE f.target = u.fid) AS followers
    FROM users u`);
  const seeded = new Set<number>(JSON.parse(kvGet("reputation.trusted") ?? "[]"));
  // pass 1: proxy trust from raw followers; pass 2: count reputable followers only
  const warm = config.reputationWarmupMs;
  const pass1 = new Map(
    users.map((u) => [u.fid, seeded.has(u.fid) ? 1 : computeReputation({ fid: u.fid, createdAt: u.created_at, posts: u.posts, followers: u.followers }, Date.now(), warm)]),
  );
  const reputableFollowers = new Map<number, number>();
  for (const f of all<{ fid: number; target: number }>("SELECT fid, target FROM follows")) {
    if ((pass1.get(f.fid) ?? 0) >= REPUTATION_VERIFIED) reputableFollowers.set(f.target, (reputableFollowers.get(f.target) ?? 0) + 1);
  }
  tx(() => {
    for (const u of users) {
      const rf = reputableFollowers.get(u.fid) ?? 0;
      const rep = seeded.has(u.fid)
        ? 1
        : computeReputation({ fid: u.fid, createdAt: u.created_at, posts: u.posts, followers: u.followers, reputableFollowers: rf }, Date.now(), warm);
      run(
        "INSERT INTO reputation(fid, rep, verified_followers) VALUES(?,?,?) ON CONFLICT(fid) DO UPDATE SET rep = excluded.rep, verified_followers = excluded.verified_followers",
        u.fid,
        rep,
        rf,
      );
    }
  });
}

// ------------------------------------------------------------------ scouts

/** All scouting signals: onchain follows, signed Back actions, and likes on a creator's posts. */
export function collectBackings(topic?: string): Backing[] {
  const topicFilter = topic
    ? `AND creator IN (SELECT DISTINCT p.fid FROM posts p JOIN post_tags t ON t.hash = p.hash WHERE t.tag = '${topic.replace(/[^a-z0-9_]/g, "")}')`
    : "";
  return all<Backing>(`
    SELECT scout, creator, MIN(at) AS at FROM (
      SELECT fid AS scout, target AS creator, ts AS at FROM follows
      UNION ALL SELECT fid, creator, ts FROM backs
      UNION ALL SELECT r.fid, p.fid, r.ts FROM reactions r JOIN posts p ON p.hash = r.target WHERE r.type = 'like'
    ) WHERE scout != creator ${topicFilter}
    GROUP BY scout, creator`);
}

/** Reputation per fid, and follow times per creator counting only verified (reputable) followers. */
function verifiedIndex() {
  const reps = new Map(all<{ fid: number; rep: number }>("SELECT fid, rep FROM reputation").map((r) => [r.fid, r.rep]));
  const verifiedFollowTimes = new Map<number, number[]>();
  for (const f of all<{ fid: number; target: number; ts: number }>("SELECT fid, target, ts FROM follows ORDER BY ts")) {
    if ((reps.get(f.fid) ?? 0) < REPUTATION_VERIFIED) continue;
    const list = verifiedFollowTimes.get(f.target) ?? [];
    list.push(f.ts);
    verifiedFollowTimes.set(f.target, list);
  }
  return { reps, verifiedFollowTimes };
}

/**
 * A scout's picks, computed live with the same rules as the official score: for each creator they backed,
 * verified followers when they backed vs now, and the points that growth is worth.
 */
export function picksFor(fid: number) {
  const { reps, verifiedFollowTimes } = verifiedIndex();
  const verifiedAt = (c: number, at: number) => (verifiedFollowTimes.get(c) ?? []).filter((t) => t < at).length;
  const raw = (c: number, at = Infinity) => get<{ n: number }>("SELECT COUNT(*) AS n FROM follows WHERE target = ? AND ts < ?", c, at === Infinity ? Number.MAX_SAFE_INTEGER : at)!.n;
  const picks = collectBackings()
    .filter((b) => b.scout === fid)
    .map((b) => {
      const from = verifiedAt(b.creator, b.at);
      const now = (verifiedFollowTimes.get(b.creator) ?? []).length;
      const growth = Math.log2((now + 1) / (from + 1));
      return {
        creator: b.creator,
        at: b.at,
        verifiedFrom: from,
        verifiedNow: now,
        followersFrom: raw(b.creator, b.at),
        followersNow: raw(b.creator),
        points: Math.max(0, Math.round(growth * 1000)),
        hit: growth >= 1,
      };
    })
    .sort((a, b) => b.points - a.points || b.at - a.at);
  const rep = reps.get(fid) ?? 0;
  return { reputation: rep, canScore: rep >= REPUTATION_VERIFIED, picks };
}

export function scoutScoresFor(topic?: string) {
  const { reps, verifiedFollowTimes } = verifiedIndex();
  return computeScoutScores({
    backings: collectBackings(topic),
    reputationOf: (fid) => reps.get(fid) ?? 0,
    verifiedFollowersAt: (c, at) => (verifiedFollowTimes.get(c) ?? []).filter((t) => t < at).length,
    verifiedFollowersNow: (c) => (verifiedFollowTimes.get(c) ?? []).length,
  });
}

export async function updateScouts() {
  const scores = scoutScoresFor();
  tx(() => {
    run("DELETE FROM scout_scores");
    for (const s of scores)
      run(
        "INSERT INTO scout_scores(fid, score, backed, hits, top) VALUES(?,?,?,?,?)",
        s.fid,
        s.score,
        s.backed,
        s.hits,
        JSON.stringify(s.topFinds),
      );
  });

  // post a root at most every 10 minutes, and only when scores changed
  const nonzero = scores.filter((s) => s.score > 0);
  if (nonzero.length === 0) return;
  const digest = keccak256(toBytes(JSON.stringify(nonzero.map((s) => [s.fid, s.score]))));
  const last = Number(kvGet("scouts.postedAt") ?? 0);
  if (digest === kvGet("scouts.digest") || Date.now() - last < config.scoutRootIntervalMs) return;
  const tree = scoutTree(nonzero.map((s) => ({ fid: BigInt(s.fid), score: BigInt(s.score) })));
  const epoch = BigInt(Math.floor(Date.now() / 3_600_000));
  await send({
    address: deployment.scouts,
    abi: scoutsAbi,
    functionName: "post",
    args: [epoch, tree.root as Hex, `${config.publicUrl}/v1/scouts`],
  });
  kvSet("scouts.digest", digest);
  kvSet("scouts.postedAt", String(Date.now()));
  console.log(`[scouts] posted root for ${nonzero.length} scouts`);
}

// ------------------------------------------------------------------ trials

interface TrialRow {
  hash: Hex;
  fid: number;
  ts: number;
  trial: string;
  trial_status: "testing" | "released" | "dropped";
  trial_group: string | null;
}

export function creatorAverageRate(fid: number): number {
  const r = get<{ rate: number | null }>(
    `SELECT AVG(CAST(e AS REAL) / v) AS rate FROM (
       SELECT p.hash,
         (SELECT COUNT(*) FROM views w WHERE w.target = p.hash) AS v,
         (SELECT COUNT(*) FROM reactions r WHERE r.target = p.hash AND r.type = 'like') +
         (SELECT COUNT(*) FROM posts c WHERE c.parent = p.hash) AS e
       FROM posts p WHERE p.fid = ? AND p.trial IS NULL AND p.deleted = 0)
     WHERE v > 0`,
    fid,
  );
  return r?.rate ?? 0.05;
}

export function variantResults(t: TrialRow) {
  const body = JSON.parse(t.trial) as TrialBody["trial"];
  const v = get<{ reach: number; views: number; dwell: number; completion: number }>(
    "SELECT COUNT(DISTINCT fid) AS reach, COUNT(*) AS views, COALESCE(AVG(dwell_ms),0) AS dwell, COALESCE(AVG(completion),0) AS completion FROM views WHERE target = ?",
    t.hash,
  )!;
  const likes = get<{ n: number }>("SELECT COUNT(*) AS n FROM reactions WHERE target = ? AND type = 'like'", t.hash)!.n;
  const replies = get<{ n: number }>("SELECT COUNT(*) AS n FROM posts WHERE parent = ? AND deleted = 0", t.hash)!.n;
  const backs = get<{ n: number }>("SELECT COUNT(*) AS n FROM backs WHERE target = ?", t.hash)!.n;
  const followsGained = get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM follows f WHERE f.target = ? AND f.ts >= ? AND f.fid IN (
       SELECT fid FROM views WHERE target = ? UNION SELECT fid FROM reactions WHERE target = ? UNION SELECT fid FROM backs WHERE target = ?)`,
    t.fid,
    t.ts,
    t.hash,
    t.hash,
    t.hash,
  )!.n;
  const reach = Math.max(v.reach, likes, backs);
  return {
    hash: t.hash,
    variant: body.variant ?? null,
    reach,
    views: v.views,
    avgDwellMs: Math.round(v.dwell),
    completion: v.completion,
    likes,
    replies,
    backs,
    followsGained,
    engagementRate: reach ? (likes + replies + backs + followsGained) / reach : 0,
  };
}

export function trialResults(hash: Hex) {
  const t = get<TrialRow>("SELECT hash, fid, ts, trial, trial_status, trial_group FROM posts WHERE hash = ? AND trial IS NOT NULL", hash);
  if (!t) return null;
  const group = t.trial_group
    ? all<TrialRow>("SELECT hash, fid, ts, trial, trial_status, trial_group FROM posts WHERE trial_group = ? AND fid = ? ORDER BY ts", t.trial_group, t.fid)
    : [t];
  const body = JSON.parse(t.trial) as TrialBody["trial"];
  const statuses = group.map((g) => g.trial_status);
  const status = statuses.includes("released") ? "released" : statuses.every((s) => s === "dropped") ? "dropped" : "testing";
  return {
    hash: group[0]!.hash,
    status,
    variants: group.map(variantResults),
    creatorAverageRate: creatorAverageRate(t.fid),
    autoRelease: body.autoRelease ? { windowHours: body.autoRelease.windowHours, endsAt: t.ts + body.autoRelease.windowHours * 3_600_000 } : null,
  };
}

/** Auto-release: the creator's signed rule ("share if it beats my average within 24h") is applied deterministically. */
export function processTrials() {
  const due = all<TrialRow>("SELECT hash, fid, ts, trial, trial_status, trial_group FROM posts WHERE trial_status = 'testing' AND deleted = 0");
  const done = new Set<string>();
  for (const t of due) {
    const key = t.trial_group ? `${t.fid}:${t.trial_group}` : t.hash;
    if (done.has(key)) continue;
    done.add(key);
    const body = JSON.parse(t.trial) as TrialBody["trial"];
    if (!body.autoRelease) continue;
    const endsAt = t.ts + body.autoRelease.windowHours * 3_600_000;
    const res = trialResults(t.hash)!;
    const best = [...res.variants].sort((a, b) => b.engagementRate - a.engagementRate)[0]!;
    const beat = best.reach >= 5 && best.engagementRate > res.creatorAverageRate;
    if (!beat && Date.now() < endsAt) continue;
    if (!beat) continue; // window over without beating average: stays a trial, creator decides
    tx(() => {
      run("UPDATE posts SET trial_status = 'released' WHERE hash = ?", best.hash);
      if (t.trial_group)
        run(
          "UPDATE posts SET trial_status = 'dropped' WHERE trial_group = ? AND fid = ? AND hash != ? AND trial_status = 'testing'",
          t.trial_group,
          t.fid,
          best.hash,
        );
    });
    console.log(`[trials] auto-released ${best.hash.slice(0, 10)}… (rate ${best.engagementRate.toFixed(2)} > avg ${res.creatorAverageRate.toFixed(2)})`);
  }
}

// ------------------------------------------------------------------ payouts

let paymentsMeta: { genesis: number; epochLength: number } | null = null;
async function epochMeta() {
  if (!paymentsMeta) {
    const [genesis, epochLength] = await Promise.all([
      publicClient.readContract({ address: deployment.payments, abi: paymentsAbi, functionName: "genesis" }),
      publicClient.readContract({ address: deployment.payments, abi: paymentsAbi, functionName: "epochLength" }),
    ]);
    paymentsMeta = { genesis: Number(genesis) * 1000, epochLength: Number(epochLength) * 1000 };
  }
  return paymentsMeta;
}

export async function currentEpoch() {
  const m = await epochMeta();
  return Math.floor((Date.now() - m.genesis) / m.epochLength);
}

export async function processPayouts() {
  const m = await epochMeta();
  const cur = Number(await publicClient.readContract({ address: deployment.payments, abi: paymentsAbi, functionName: "currentEpoch" }));
  const reps = new Map(all<{ fid: number; rep: number }>("SELECT fid, rep FROM reputation").map((r) => [r.fid, r.rep]));
  const tokens: Address[] = [deployment.tusd.toLowerCase() as Address, NATIVE];
  for (let e = Number(kvGet("payouts.nextEpoch") ?? 0); e < cur; e++) {
    for (const token of tokens) {
      const posted = await publicClient.readContract({ address: deployment.payments, abi: paymentsAbi, functionName: "payoutRoot", args: [BigInt(e), token] });
      if (posted !== `0x${"0".repeat(64)}`) continue;
      const pool = await publicClient.readContract({ address: deployment.payments, abi: paymentsAbi, functionName: "creatorPool", args: [BigInt(e), token] });
      if (pool === 0n) continue;
      const start = m.genesis + e * m.epochLength;
      const end = start + m.epochLength;
      const payments = all<{ subscriber_fid: number; feed_id: number; to_creators: string }>(
        "SELECT subscriber_fid, feed_id, to_creators FROM sub_payments WHERE epoch = ? AND token = ?",
        e,
        token,
      ).map((p) => ({ subscriberFid: p.subscriber_fid, feedId: p.feed_id, token, toCreators: BigInt(p.to_creators) }));
      // engagement signed by subscribers' own app keys during the epoch
      const engagement = all<{ fid: number; feed_id: number; creator: number; views: number; likes: number; replies: number }>(
        `SELECT v.fid, v.feed_id, v.creator, COUNT(*) AS views,
           (SELECT COUNT(*) FROM reactions r JOIN posts p ON p.hash = r.target WHERE r.fid = v.fid AND p.fid = v.creator AND r.type = 'like' AND r.ts BETWEEN ? AND ?) AS likes,
           (SELECT COUNT(*) FROM posts c JOIN posts p ON p.hash = c.parent WHERE c.fid = v.fid AND p.fid = v.creator AND c.ts BETWEEN ? AND ?) AS replies
         FROM views v WHERE v.ts BETWEEN ? AND ? AND v.feed_id > 0 GROUP BY v.fid, v.feed_id, v.creator`,
        start, end, start, end, start, end,
      ).map((r) => ({ subscriberFid: r.fid, feedId: r.feed_id, creatorFid: r.creator, views: r.views, likes: r.likes, replies: r.replies }));
      const owners = new Map(all<{ id: number; owner_fid: number }>("SELECT id, owner_fid FROM feeds").map((f) => [f.id, f.owner_fid]));
      // A paying subscriber only routes their own money, so new accounts count fully here; reputation
      // weighting is for free signals (discovery, scouts). Self-pay and feed-owner views are excluded.
      const alloc = allocatePayouts(payments, engagement, {
        reputationOf: (f) => reps.get(f) ?? 0,
        minReputation: 0,
        feedOwnerOf: (id) => owners.get(id) ?? 0,
      });
      const total = alloc.reduce((a, b) => a + b.amount, 0n);
      let root: Hex = keccak256(toBytes(`empty:${e}:${token}`));
      let tree: ReturnType<typeof payoutTree> | null = null;
      if (alloc.length) {
        tree = payoutTree(alloc.map((a) => ({ epoch: BigInt(e), token, fid: BigInt(a.fid), amount: a.amount })));
        root = tree.root as Hex;
      }
      const { hash } = await send({
        address: deployment.payments,
        abi: paymentsAbi,
        functionName: "postPayoutRoot",
        args: [BigInt(e), token, root, total, `${config.publicUrl}/v1/payouts/${e}`],
      });
      tx(() => {
        run("INSERT OR REPLACE INTO payout_roots(epoch, token, root, total, tx) VALUES(?,?,?,?,?)", e, token, root, String(total), hash);
        if (tree)
          for (const [i, v] of tree.entries())
            run(
              "INSERT OR REPLACE INTO payout_leaves(epoch, token, fid, amount, proof, claimed) VALUES(?,?,?,?,?,0)",
              e,
              token,
              Number(v[2]),
              String(v[3]),
              JSON.stringify(tree.getProof(i)),
            );
      });
      console.log(`[payouts] epoch ${e} ${token === NATIVE ? "MON" : "tUSD"}: ${alloc.length} creators, ${total}/${pool} allocated`);
    }
    kvSet("payouts.nextEpoch", String(e + 1));
  }
}

// ------------------------------------------------------------------ default labeler

const labelerAccount = privateKeyToAccount(config.labelerKey);
let labelerSeq = Number(kvGet("labeler.seq") ?? 0);

const BAIT = [
  /\b(like|rt|repost|retweet|share)\s+if\b/i,
  /\bfollow\s*(for|4)\s*follow\b/i,
  /\bcomment\s+["“]?(yes|yes!|1)["”]?\b/i,
  /\btag\s+(3|three|a friend)\b/i,
  /\bdrop\s+your\s+(wallet|address)\b/i,
];

export function classify(text: string, links: string[]): string[] {
  const labels: string[] = [];
  if (BAIT.some((r) => r.test(text))) labels.push("engagement-bait");
  if (/\b(giveaway|airdrop claim|free mon)\b/i.test(text)) labels.push("giveaway");
  if (links.length >= 3 || (text.length > 40 && text === text.toUpperCase() && /[A-Z]/.test(text))) labels.push("spam");
  if (/seed phrase|private key|connect wallet to claim/i.test(text)) labels.push("scam");
  return labels;
}

/** Publish labels on a post as the default labeler (@monsoc). Shared by the keyword and AI labelers so seq stays ordered. */
let labelQueue: Promise<unknown> = Promise.resolve();
export function publishLabels(target: Hex, labels: string[]): Promise<void> {
  const job = labelQueue.then(async () => {
    const fid = Number(kvGet("labeler.fid") ?? 0);
    if (!fid || !labels.length) return;
    labelerSeq += 1;
    kvSet("labeler.seq", String(labelerSeq));
    const msg = await signMessage(labelerAccount, {
      type: "label",
      fid,
      timestamp: Date.now(),
      seq: labelerSeq,
      body: { target, labels },
    });
    try {
      await ingest(msg, { source: "local" });
    } catch (e) {
      console.warn("[labeler]", (e as Error).message);
    }
  });
  labelQueue = job.catch(() => undefined);
  return job;
}

export function startLabeler() {
  bus.on("message", (m: SignedMessage) => {
    if (!["post", "reply", "trial-post"].includes(m.data.type)) return;
    const body = m.data.body as PostBody;
    const labels = classify(body.text, body.links ?? []);
    if (labels.length) void publishLabels(m.hash, labels);
  });
}

// ------------------------------------------------------------------ chat retention + peers

export async function pruneChat() {
  for (const c of all<{ id: number; meta: string | null }>("SELECT id, meta FROM communities")) {
    const days = (c.meta ? (JSON.parse(c.meta).chatRetentionDays as number | undefined) : undefined) ?? 30;
    const cutoff = Date.now() - days * 86_400_000;
    const old = all<{ hash: string }>("SELECT hash FROM chat WHERE community = ? AND ts < ?", c.id, cutoff);
    if (!old.length) continue;
    tx(() => {
      for (const o of old) {
        run("DELETE FROM chat WHERE hash = ?", o.hash);
        run("DELETE FROM messages WHERE hash = ?", o.hash);
      }
    });
  }
}

export async function syncPeers() {
  for (const peer of config.peers) {
    const key = `peer.${peer}`;
    const since = Number(kvGet(key) ?? 0);
    try {
      const res = await fetch(`${peer}/v1/messages?since=${since}&limit=500`, { signal: AbortSignal.timeout(5000) });
      const { messages, next } = (await res.json()) as { messages: SignedMessage[]; next: number };
      for (const m of messages) await ingest(m, { relaxedTime: true, source: "peer" }).catch(() => undefined);
      kvSet(key, String(next));
    } catch (e) {
      console.warn(`[peers] ${peer}: ${(e as Error).message}`);
    }
  }
}

/** Refresh feed metadata that failed to resolve at index time (e.g. slow IPFS). */
async function refreshMeta() {
  for (const f of all<{ id: number; uri: string }>("SELECT id, uri FROM feeds WHERE meta IS NULL OR meta = 'null' LIMIT 10")) {
    const meta = await resolveUri(f.uri);
    if (meta) run("UPDATE feeds SET meta = ? WHERE id = ?", JSON.stringify(meta), f.id);
  }
}

export function startJobs() {
  startLabeler();
  const loop = async () => {
    for (const [name, fn] of [
      ["reputation", updateReputation],
      ["scouts", updateScouts],
      ["trials", processTrials],
      ["payouts", processPayouts],
      ["chat", pruneChat],
      ["meta", refreshMeta],
    ] as const) {
      try {
        await fn();
      } catch (e) {
        console.error(`[jobs:${name}]`, (e as Error).message);
      }
    }
    setTimeout(loop, config.jobsIntervalMs);
  };
  setTimeout(loop, 2000);
  if (config.peers.length) {
    const peerLoop = async () => {
      await syncPeers();
      setTimeout(peerLoop, 5000);
    };
    peerLoop();
  }
}
