import type { Hex } from "viem";

const env = process.env;

export const config = {
  port: Number(env.PORT ?? 8787),
  publicUrl: env.PUBLIC_URL ?? `http://localhost:${env.PORT ?? 8787}`,
  chainId: Number(env.CHAIN_ID ?? 31337),
  rpcUrl: env.RPC_URL ?? "http://127.0.0.1:8546",
  /** relay wallet: pays sponsored gas, anchors batches, posts payout + scout roots. Defaults to anvil #0. */
  relayKey: (env.RELAY_PRIVATE_KEY ?? "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80") as Hex,
  /** the default labeler's app key (registered by the seed script). Dev-only default. */
  labelerKey: (env.LABELER_PRIVATE_KEY ?? "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d") as Hex,
  dbPath: env.DB_PATH ?? "./relay.db",
  anchorIntervalMs: Number(env.ANCHOR_INTERVAL_MS ?? 60_000),
  indexIntervalMs: Number(env.INDEX_INTERVAL_MS ?? 1_000),
  /** eth_getLogs block span per request; Monad public RPCs cap this low */
  logRange: BigInt(env.LOG_RANGE ?? 100),
  jobsIntervalMs: Number(env.JOBS_INTERVAL_MS ?? 30_000),
  /** other relays to pull messages from (comma separated base URLs) */
  peers: (env.PEERS ?? "").split(",").filter(Boolean),
  /** sponsored transactions per fid per day, before reputation bonus */
  sponsorBudget: Number(env.SPONSOR_BUDGET ?? 200),
  messageRatePerMinute: Number(env.MESSAGE_RATE ?? 30),
  maxClockSkewMs: 10 * 60_000,
  ipfsGateway: env.IPFS_GATEWAY ?? "https://ipfs.io/ipfs/",
  faucetEnabled: (env.FAUCET ?? "true") === "true",
};
