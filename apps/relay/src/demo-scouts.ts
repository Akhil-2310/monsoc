/**
 * Live scouting demo on testnet. Creates clearly-named demo accounts through the real protocol paths
 * (signed signup, sponsored calls, signed messages) and, on cue, makes the creator grow.
 *
 *   pnpm demo:scouts setup    create @newcreator (with a trial post) + 4 fans (each posts, so they earn reputation)
 *   pnpm demo:scouts grow     fans follow @newcreator one by one (run this live, after you tap Back)
 *   pnpm demo:scouts status   reputations, follower counts, who counts as verified
 *
 * Fans only count as verified followers once their reputation >= 50%, which needs account age
 * (REPUTATION_WARMUP_HOURS; set it to 1 on testnet) plus a few posts. Run `setup` an hour before the demo.
 * Keys are kept in apps/relay/.demo-keys.json (gitignored).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { encodeFunctionData, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import {
  RelayClient,
  MessageBuilder,
  signForwardRequest,
  signupTypedData,
  Scopes,
  KeyTypes,
  followsAbi,
  marketsAbi,
  type BodyFor,
  type MessageType,
} from "@monsoc/sdk";
import { config } from "./config";
import { deployment, publicClient } from "./chain";

const KEYS = new URL("../.demo-keys.json", import.meta.url).pathname;
const relay = new RelayClient(config.publicUrl);
const keys: Record<string, Hex> = existsSync(KEYS) ? JSON.parse(readFileSync(KEYS, "utf8")) : {};
const save = () => writeFileSync(KEYS, JSON.stringify(keys, null, 2), { mode: 0o600 });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const CREATOR = { handle: "newcreator", name: "Nova (new creator)" };
const FANS = [
  { handle: "fan_ana", name: "Ana" },
  { handle: "fan_ben", name: "Ben" },
  { handle: "fan_cai", name: "Cai" },
  { handle: "fan_dev", name: "Dev" },
];

class Demo {
  key!: PrivateKeyAccount;
  fid = 0;
  b!: MessageBuilder;
  constructor(public handle: string) {}

  async init() {
    keys[`${this.handle}.custody`] ??= generatePrivateKey();
    keys[`${this.handle}.app`] ??= generatePrivateKey();
    save();
    const custody = privateKeyToAccount(keys[`${this.handle}.custody`]!);
    this.key = privateKeyToAccount(keys[`${this.handle}.app`]!);
    const existing = await relay.userByCustody(custody.address);
    if (existing) this.fid = existing.fid;
    else {
      const taken = await relay.user(this.handle).catch(() => null);
      if (taken) throw new Error(`@${this.handle} is taken by another account; rename it in demo-scouts.ts`);
      const nonce = await relay.signupNonce(custody.address);
      const params = {
        custody: custody.address,
        recovery: custody.address,
        handle: this.handle,
        keyType: KeyTypes.SECP256K1,
        key: this.key.address.toLowerCase() as Hex,
        scope: Scopes.FULL,
        expiry: 0n,
        clientFid: 0n,
        deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
      };
      const sig = await custody.signTypedData(signupTypedData(config.chainId, deployment.signup, params, nonce));
      this.fid = (await relay.signup(params, sig)).fid;
      console.log(`  created @${this.handle} (fid ${this.fid})`);
    }
    this.b = new MessageBuilder(this.key, this.fid, Math.floor(Date.now() / 1000));
    return this;
  }

  send<T extends MessageType>(type: T, body: BodyFor<T>) {
    return this.b.build(type, body).then((m) => relay.submit(m));
  }

  async call(to: Address, abi: readonly unknown[], functionName: string, args: readonly unknown[]) {
    const data = encodeFunctionData({ abi: abi as never, functionName, args } as never);
    const gas = ((await publicClient.estimateGas({ account: this.key.address, to, data })) * 12n) / 10n + 30_000n;
    const nonce = await relay.forwarderNonce(this.key.address);
    const r = await relay.forward(await signForwardRequest(this.key, { chainId: config.chainId, forwarder: deployment.forwarder, to, data, nonce, gas }));
    if (r.status !== "success") throw new Error(`${functionName} reverted`);
  }
}

async function setup() {
  console.log("Creating demo accounts on chain", config.chainId);
  const creator = await new Demo(CREATOR.handle).init();
  await creator.send("profile", { displayName: CREATOR.name, bio: "Just started posting about AI agents. Early days!" });
  await creator.send("post", { text: "Hello! Starting to share what I learn building AI agents #ai", tags: ["ai"] });
  await creator.send("post", { text: "Small models + good retrieval beat big models + bad retrieval more often than you'd think #ai", tags: ["ai"] });
  await creator.send("trial-post", {
    text: "Thread: 5 mistakes I made shipping my first AI agent (and how to avoid them) #ai",
    tags: ["ai"],
    trial: { topics: ["ai"], autoRelease: { windowHours: 24, beatAverage: true } },
  });
  if (deployment.markets) await creator.call(deployment.markets, marketsAbi, "setOptIn", [BigInt(creator.fid), true]).catch(() => undefined);
  console.log(`  @${CREATOR.handle}: profile, 2 posts, 1 trial post in #ai, markets enabled`);

  for (const f of FANS) {
    const fan = await new Demo(f.handle).init();
    await fan.send("profile", { displayName: f.name });
    for (const t of ["gm everyone", "Exploring feeds on Monsoc today", "Following more AI builders this week #ai"])
      await fan.send("post", { text: `${t}`, tags: t.includes("#ai") ? ["ai"] : undefined });
    console.log(`  @${f.handle}: profile + 3 posts`);
  }
  console.log(`
Done. Next:
  1. Wait for the reputation warm-up (REPUTATION_WARMUP_HOURS, e.g. 1 hour) so the fans count as verified.
  2. In the app, as yourself: find @${CREATOR.handle}'s trial post (AI feed) and tap Back. Post a few times so your own reputation reaches 50%.
  3. Live in the demo: pnpm demo:scouts grow`);
}

async function grow() {
  const creator = await new Demo(CREATOR.handle).init();
  console.log(`Fans following @${CREATOR.handle} (fid ${creator.fid})…`);
  for (const f of FANS) {
    const fan = await new Demo(f.handle).init();
    await fan.call(deployment.follows, followsAbi, "follow", [BigInt(fan.fid), BigInt(creator.fid)]);
    const p = await relay.user(CREATOR.handle);
    console.log(`  @${f.handle} followed → @${CREATOR.handle} now has ${p.followers} followers (${p.verifiedFollowers} verified)`);
    await sleep(8_000);
  }
  console.log("Done. Watch Scouts → Your picks and the leaderboard (scores refresh every few seconds).");
}

async function status() {
  for (const h of [CREATOR.handle, ...FANS.map((f) => f.handle)]) {
    const p = await relay.user(h).catch(() => null);
    if (!p) {
      console.log(`  @${h}: not created`);
      continue;
    }
    const verified = p.reputation >= 0.5 ? "verified" : "not yet verified";
    console.log(`  @${h}: reputation ${(p.reputation * 100).toFixed(0)}% (${verified}), ${p.followers} followers (${p.verifiedFollowers} verified)`);
  }
}

const cmd = process.argv[2];
const run = cmd === "setup" ? setup : cmd === "grow" ? grow : cmd === "status" ? status : null;
if (!run) {
  console.log("usage: pnpm demo:scouts setup | grow | status");
  process.exit(1);
}
run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[demo]", e.message ?? e);
    process.exit(1);
  });
