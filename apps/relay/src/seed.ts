/**
 * Seeds a living network through the real protocol paths (signed signup, sponsored forwarder calls,
 * signed messages to the relay), so the demo feed is full from the first minute.
 *
 *   pnpm seed            (relay must be running)
 */
import { encodeFunctionData, keccak256, toBytes, type Address, type Hex, type LocalAccount } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  RelayClient,
  MessageBuilder,
  signForwardRequest,
  signupTypedData,
  feedHash,
  DEFAULT_FEEDS,
  Scopes,
  KeyTypes,
  followsAbi,
  feedsAbi,
  communitiesAbi,
  paymentsAbi,
  tusdAbi,
  type FeedDefinition,
  type SignedMessage,
  type MessageType,
  type BodyFor,
} from "@monsoc/sdk";
import { config } from "./config";
import { kvSet } from "./db";
import { deployment } from "./chain";

const relay = new RelayClient(config.publicUrl);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Demo keys are derived from the handle so the web client can offer "try as @handle" on dev chains. */
export const demoKey = (handle: string, kind: "custody" | "app") => keccak256(toBytes(`monsoc-demo:${kind}:${handle}`));

class Actor {
  custody: LocalAccount;
  key: LocalAccount;
  fid = 0;
  builder!: MessageBuilder;
  constructor(
    public handle: string,
    appKey?: Hex,
  ) {
    this.custody = privateKeyToAccount(demoKey(handle, "custody"));
    this.key = privateKeyToAccount(appKey ?? demoKey(handle, "app"));
  }

  async signup() {
    const existing = await relay.userByCustody(this.custody.address);
    if (existing) {
      this.fid = existing.fid;
    } else {
      const nonce = await relay.signupNonce(this.custody.address);
      const params = {
        custody: this.custody.address,
        recovery: this.custody.address,
        handle: this.handle,
        keyType: KeyTypes.SECP256K1,
        key: this.key.address.toLowerCase() as Hex,
        scope: Scopes.FULL,
        expiry: 0n,
        clientFid: 0n,
        deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
      };
      const sig = await this.custody.signTypedData(signupTypedData(config.chainId, deployment.signup, params, nonce));
      this.fid = (await relay.signup(params, sig)).fid;
    }
    this.builder = new MessageBuilder(this.key, this.fid, Math.floor(Date.now() / 1000));
    return this;
  }

  async call(to: Address, abi: readonly unknown[], functionName: string, args: readonly unknown[]) {
    const data = encodeFunctionData({ abi: abi as never, functionName, args } as never);
    const nonce = await relay.forwarderNonce(this.key.address);
    const req = await signForwardRequest(this.key, { chainId: config.chainId, forwarder: deployment.forwarder, to, data, nonce });
    const r = await relay.forward(req);
    if (r.status !== "success") throw new Error(`${this.handle} ${functionName} reverted`);
  }

  async send<T extends MessageType>(type: T, body: BodyFor<T>, agoMs = 0): Promise<SignedMessage<T>> {
    const m = await this.builder.build(type, body, Date.now() - agoMs);
    await relay.submit(m);
    return m;
  }
}

const dataUri = (obj: unknown) => `data:application/json;base64,${Buffer.from(JSON.stringify(obj)).toString("base64")}`;

const CREATORS = [
  "arjun", "meera", "kabir", "zoya", "dev", "nisha", "rohan", "tara",
  "vikram", "ananya", "sam", "lena", "omar", "priya", "noah", "ira",
];

const POSTS: Record<string, string[]> = {
  ai: [
    "Shipped an eval harness that scores agents on real tasks instead of vibes. Repo going public next week #ai",
    "Hot take: most RAG bugs are chunking bugs. Fix your splitter before you swap your model #ai",
    "We cut our inference bill 60% by caching tool results, not prompts. Happy to share the numbers #ai",
    "What's the best open benchmark for multi-step tool use right now? Looking for something that isn't saturated #ai",
    "Small models + good retrieval beat big models + bad retrieval in every test we ran this month #ai",
  ],
  monad: [
    "Parallel execution means your contract's storage layout matters again. Hot slots = conflicts #monad",
    "Built a social graph contract where follows are 1-second confirmations. Feels like web2 #monad",
    "Monad devnet gas was so cheap I forgot to batch. Then I batched anyway. Habits. #monad",
    "Anyone benchmarking MonadBFT finality from India? Seeing ~1s on our side #monad",
    "Reminder: sponsored gas + app keys = users never see a wallet popup. That's the whole UX unlock #monad",
  ],
  defi: [
    "Stablecoin-priced subscriptions paid in MON at spot: the oracle choice is the whole design #defi",
    "Liquidity is a social graph problem. Whoever owns distribution owns the flow #defi",
    "Writing up how we priced our perp vault fees. Long thread incoming #defi",
  ],
  cricket: [
    "That last over was pure chaos. Two wides, a run out and a six. Test cricket who? #cricket",
    "Unpopular opinion: the impact player rule made T20 better, not worse #cricket",
    "Building a ball-by-ball feed that only shows wickets and milestones. Anyone want in? #cricket",
  ],
  design: [
    "Optimistic UI is a design decision, not an engineering one. Decide what 'instant' means first #design",
    "Our feed switcher went from a dropdown to a swipeable pill row and usage tripled #design",
  ],
};

const BAIT = [
  "LIKE IF you want free MON 🚀🚀 follow for follow!! comment YES",
  "GIVEAWAY: drop your wallet address below, tag 3 friends",
];

async function main() {
  const info = await relay.info().catch(() => null);
  if (!info) throw new Error(`relay not reachable at ${config.publicUrl}; start it with pnpm relay`);
  console.log(`[seed] relay ok, chain ${info.chainId}`);

  // ---------------------------------------------------------------- accounts
  const labeler = await new Actor("labeler", config.labelerKey).signup();
  kvSet("labeler.fid", String(labeler.fid));
  kvSet("labelers.default", JSON.stringify([labeler.fid]));

  const people: Record<string, Actor> = {};
  for (const h of CREATORS) {
    people[h] = await new Actor(h).signup();
    process.stdout.write(`@${h}#${people[h].fid} `);
  }
  console.log();
  const P = (h: string) => people[h]!;
  kvSet("reputation.trusted", JSON.stringify(CREATORS.slice(0, 10).map((h) => P(h).fid)));

  // ---------------------------------------------------------------- scouts back small creators first
  // tara and ira start tiny; meera and kabir spot them early, then the crowd arrives.
  await P("meera").call(deployment.follows, followsAbi, "followBatch", [BigInt(P("meera").fid), [BigInt(P("tara").fid), BigInt(P("ira").fid)]]);
  await P("kabir").call(deployment.follows, followsAbi, "follow", [BigInt(P("kabir").fid), BigInt(P("tara").fid)]);
  await sleep(2500);

  // ---------------------------------------------------------------- the rest of the graph
  const graph: Record<string, string[]> = {
    arjun: ["meera", "kabir", "zoya", "dev", "tara", "rohan", "ira"],
    meera: ["arjun", "kabir", "nisha"],
    kabir: ["arjun", "meera", "vikram"],
    zoya: ["arjun", "nisha", "tara", "lena"],
    dev: ["arjun", "meera", "tara", "ira", "omar"],
    nisha: ["zoya", "meera", "tara", "ira"],
    rohan: ["arjun", "vikram", "ananya", "tara"],
    tara: ["arjun", "meera"],
    vikram: ["rohan", "kabir", "tara", "ira"],
    ananya: ["rohan", "priya", "tara", "ira"],
    sam: ["lena", "omar", "tara", "noah", "ira"],
    lena: ["sam", "zoya", "tara", "ira"],
    omar: ["sam", "dev", "tara"],
    priya: ["ananya", "nisha", "tara", "ira"],
    noah: ["sam", "lena", "ira"],
    ira: ["noah"],
  };
  for (const [h, targets] of Object.entries(graph)) {
    await P(h).call(deployment.follows, followsAbi, "followBatch", [BigInt(P(h).fid), targets.map((t) => BigInt(P(t).fid))]);
  }
  console.log("[seed] follow graph done");

  // ---------------------------------------------------------------- feeds
  const ruleFeed = async (owner: Actor, def: FeedDefinition, priceUsd = 0n, share = 0) => {
    const uri = dataUri({ name: def.name, description: def.description, definition: def });
    await owner.call(deployment.feeds, feedsAbi, "create", [
      BigInt(owner.fid), 0, uri, feedHash(def), priceUsd, share, Math.round(def.discovery * 10_000),
    ]);
  };
  await ruleFeed(P("arjun"), DEFAULT_FEEDS.home!);
  await ruleFeed(P("meera"), DEFAULT_FEEDS.conversations!);
  await ruleFeed(P("zoya"), DEFAULT_FEEDS.noBait!);
  await ruleFeed(P("kabir"), DEFAULT_FEEDS.ai!);
  await ruleFeed(P("rohan"), {
    version: 1,
    name: "Monad builders",
    description: "Only #monad, conversations weighted 2x, 20% discovery.",
    sources: { topics: ["monad"] },
    filters: { includeTags: ["monad"], excludeLabels: ["spam", "engagement-bait", "giveaway"] },
    weights: { replies: 2, likes: 1, conversationDepth: 1, recencyHalfLifeHours: 24 },
    discovery: 0.2,
  });
  await ruleFeed(P("vikram"), {
    version: 1,
    name: "Cricket: wickets & milestones",
    description: "Single-topic cricket feed, recency first.",
    sources: { topics: ["cricket"] },
    filters: { includeTags: ["cricket"] },
    sort: "recent",
    discovery: 0.15,
  });
  // paid hosted feed: $3 / 30 days, 60% to creators it surfaces
  {
    const owner = P("dev");
    const desc = { name: "High signal (paid)", description: "Reputable authors with real conversations. AI-ranked server feed.", endpoint: `${config.publicUrl}/hosted/high-signal` };
    await owner.call(deployment.feeds, feedsAbi, "create", [BigInt(owner.fid), 1, dataUri(desc), keccak256(toBytes(JSON.stringify(desc))), 3_000_000n, 6000, 1500]);
  }
  console.log("[seed] feeds done");

  // ---------------------------------------------------------------- communities
  const community = async (owner: Actor, joinType: number, meta: object, opts: { gate?: Address; min?: bigint; price?: bigint; period?: bigint; feedId?: bigint } = {}) => {
    await owner.call(deployment.communities, communitiesAbi, "create", [
      BigInt(owner.fid), joinType, opts.gate ?? "0x0000000000000000000000000000000000000000", opts.min ?? 0n, opts.price ?? 0n, opts.period ?? 0n, opts.feedId ?? 0n, dataUri(meta),
    ]);
  };
  await community(P("rohan"), 0, { name: "Monad Builders", description: "Shipping on Monad. Show your work.", rules: ["Be specific", "No shilling", "Share code when you can"], rooms: ["general", "help", "show-and-tell"], tags: ["monad"], chatRetentionDays: 30 }, { feedId: 5n });
  await community(P("kabir"), 0, { name: "AI Builders", description: "Agents, evals, infra. Builders only.", rules: ["Show results, not hype"], rooms: ["general", "papers"], tags: ["ai"] }, { feedId: 4n });
  await community(P("vikram"), 0, { name: "Cricket Adda", description: "Ball-by-ball banter.", rules: ["No spoilers in #highlights"], rooms: ["live", "highlights"], tags: ["cricket"] }, { feedId: 6n });
  await community(P("zoya"), 1, { name: "tUSD Holders", description: "Token-gated: hold at least 1 tUSD.", rules: ["Holders only"], rooms: ["general"], tags: ["defi"] }, { gate: deployment.tusd, min: 1_000_000n });
  await community(P("arjun"), 2, { name: "Founders Circle", description: "Invite-only room for founders.", rules: ["Chatham House rules"], rooms: ["general"], tags: ["founders"] });
  await community(P("meera"), 3, { name: "Paid AI Lab", description: "$5 / 30 days. Weekly teardown of an AI product.", rules: ["Members only"], rooms: ["general"], tags: ["ai"] }, { price: 5_000_000n, period: 30n * 86400n });
  for (const h of ["arjun", "meera", "dev", "vikram", "ananya", "tara", "omar", "ira"]) await P(h).call(deployment.communities, communitiesAbi, "join", [1n, BigInt(P(h).fid)]);
  for (const h of ["meera", "zoya", "nisha", "sam", "lena", "ira"]) await P(h).call(deployment.communities, communitiesAbi, "join", [2n, BigInt(P(h).fid)]);
  for (const h of ["rohan", "ananya", "priya", "noah"]) await P(h).call(deployment.communities, communitiesAbi, "join", [3n, BigInt(P(h).fid)]);
  console.log("[seed] communities done");

  // tUSD for a couple of users, one paid subscription so payouts have something to split
  await relay.faucet(P("zoya").custody.address).catch(() => undefined);
  await relay.faucet(P("sam").key.address).catch(() => undefined);
  await P("sam").call(deployment.tusd, tusdAbi, "approve", [deployment.payments, 2n ** 255n]);
  await P("sam").call(deployment.payments, paymentsAbi, "subscribe", [BigInt(P("sam").fid), 7n, deployment.tusd, 1]);
  console.log("[seed] payments done");

  // ---------------------------------------------------------------- posts, conversations, engagement
  const authors: Record<string, string[]> = {
    ai: ["kabir", "meera", "nisha", "sam", "ira"],
    monad: ["rohan", "arjun", "dev", "ananya", "tara"],
    defi: ["zoya", "omar", "lena"],
    cricket: ["vikram", "priya", "noah"],
    design: ["lena", "tara"],
  };
  const posted: { m: SignedMessage; author: string; topic: string }[] = [];
  let ago = 9 * 60_000;
  for (const [topic, texts] of Object.entries(POSTS)) {
    for (let i = 0; i < texts.length; i++) {
      const author = authors[topic]![i % authors[topic]!.length]!;
      const community = topic === "monad" ? 1 : topic === "ai" && ["meera", "sam", "ira"].includes(author) ? 2 : topic === "cricket" && author !== "vikram" ? 3 : undefined;
      const m = await P(author).send("post", { text: texts[i]!, tags: [topic], community }, (ago -= 5000));
      posted.push({ m, author, topic });
    }
  }
  for (const [i, text] of BAIT.entries()) await P(i ? "omar" : "noah").send("post", { text }, (ago -= 3000));

  // conversations: real back-and-forth on a few posts
  const convo = async (root: SignedMessage, turns: [string, string][]) => {
    let parent = root.hash;
    for (const [who, text] of turns) parent = (await P(who).send("reply", { text, parent }, (ago -= 2000))).hash;
  };
  await convo(posted[1]!.m, [["meera", "Agree. Semantic chunking fixed half our misses."], ["kabir", "Which splitter? We tried three."], ["meera", "Recursive + heading-aware. Will share config."], ["sam", "Following this thread, same pain here"]]);
  await convo(posted[5]!.m, [["dev", "How bad were the conflicts before you changed layout?"], ["rohan", "~30% retries on the hot path. Now under 2%."], ["ananya", "Would love a write-up on this"]]);
  await convo(posted[10]!.m, [["lena", "Oracle or DEX swap at payment time?"], ["zoya", "Oracle for quotes, swap only for settlement."]]);

  // likes and reposts, weighted toward a few posts
  const likers = Object.keys(people);
  for (const [i, p] of posted.entries()) {
    const n = (i * 7) % 9;
    for (let k = 0; k < n; k++) {
      const who = likers[(i + k * 3) % likers.length]!;
      if (who === p.author) continue;
      await P(who).send("like", { target: p.m.hash }, (ago -= 200)).catch(() => undefined);
    }
  }
  await P("arjun").send("repost", { target: posted[6]!.m.hash });

  // ---------------------------------------------------------------- trial reels (A/B) from a new creator
  const ira = P("ira");
  const tA = await ira.send("trial-post", {
    text: "60-second explainer: how a feed marketplace works on Monad #ai #monad",
    tags: ["ai", "monad"],
    media: [{ uri: "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi", kind: "video", durationMs: 60_000 }],
    trial: { topics: ["ai", "monad"], groupId: "explainer-1", variant: "A", autoRelease: { windowHours: 24, beatAverage: true } },
  });
  const tB = await ira.send("trial-post", {
    text: "Your feed is a choice now. Here's how it works in 60 seconds #ai #monad",
    tags: ["ai", "monad"],
    media: [{ uri: "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi", kind: "video", durationMs: 60_000 }],
    trial: { topics: ["ai", "monad"], groupId: "explainer-1", variant: "B", autoRelease: { windowHours: 24, beatAverage: true } },
  });
  // strangers see it in discovery slots; B hooks better
  for (const [who, t, like] of [
    ["kabir", tA, false], ["zoya", tA, false], ["vikram", tA, true], ["omar", tA, false],
    ["meera", tB, true], ["rohan", tB, true], ["ananya", tB, true], ["priya", tB, false], ["lena", tB, true], ["sam", tB, true],
  ] as [string, SignedMessage, boolean][]) {
    await P(who).send("view", { target: t.hash, feedId: 1, dwellMs: like ? 52_000 : 9_000, completion: like ? 0.9 : 0.15 });
    if (like) await P(who).send("like", { target: t.hash });
  }
  await P("rohan").send("back", { targetFid: ira.fid, target: tB.hash });
  await P("ananya").send("back", { targetFid: ira.fid, target: tB.hash });
  await P("lena").send("back", { targetFid: ira.fid, target: tB.hash });

  // views for the paid feed so the payout job has subscriber-signed engagement
  for (const p of posted.slice(0, 8)) await P("sam").send("view", { target: p.m.hash, feedId: 7, dwellMs: 20_000 }).catch(() => undefined);

  // community chat
  await P("rohan").send("chat", { community: 1, room: "general", text: "Welcome! Drop what you're building 👇" });
  await P("dev").send("chat", { community: 1, room: "general", text: "Social graph contracts + a relay. Follows confirm in ~1s." });
  await P("tara").send("chat", { community: 1, room: "general", text: "First week on Monad, any good starter repos?" });
  await P("arjun").send("chat", { community: 1, room: "help", text: "Ask here if the forwarder rejects your request, usually a nonce issue." });

  kvSet(
    "starter_packs",
    JSON.stringify([
      { id: "ai", name: "AI builders", fids: ["kabir", "meera", "nisha", "sam"].map((h) => P(h).fid) },
      { id: "monad", name: "Monad builders", fids: ["rohan", "arjun", "dev", "ananya", "tara"].map((h) => P(h).fid) },
      { id: "defi", name: "Monad DeFi", fids: ["zoya", "omar", "lena"].map((h) => P(h).fid) },
      { id: "cricket", name: "Cricket", fids: ["vikram", "priya", "noah"].map((h) => P(h).fid) },
    ]),
  );
  console.log(`[seed] done: ${CREATORS.length} creators, ${posted.length + BAIT.length} posts, trials ${tA.hash.slice(0, 10)}…/${tB.hash.slice(0, 10)}…`);
}

main().catch((e) => {
  console.error("[seed]", e);
  process.exit(1);
});
