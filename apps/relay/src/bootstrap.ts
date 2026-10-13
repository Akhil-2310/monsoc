/**
 * One-time setup for a fresh deployment. Creates only what the protocol itself needs, no sample data:
 *  - the operator account (@monsoc), whose app key is the default labeler
 *  - the default feeds every client can offer on day one
 *
 *   pnpm bootstrap      (relay must be running; safe to re-run)
 */
import { encodeFunctionData, keccak256, toBytes, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  RelayClient,
  signForwardRequest,
  signupTypedData,
  feedHash,
  DEFAULT_FEEDS,
  Scopes,
  KeyTypes,
  feedsAbi,
} from "@monsoc/sdk";
import { config } from "./config";
import { kvSet } from "./db";
import { deployment, relayAccount, publicClient } from "./chain";

const HANDLE = process.env.OPERATOR_HANDLE ?? "monsoc";
const relay = new RelayClient(config.publicUrl);
const appKey = privateKeyToAccount(config.labelerKey);
const dataUri = (o: unknown) => `data:application/json;base64,${Buffer.from(JSON.stringify(o)).toString("base64")}`;

async function call(to: Address, abi: readonly unknown[], functionName: string, args: readonly unknown[]) {
  const data = encodeFunctionData({ abi: abi as never, functionName, args } as never);
  const nonce = await relay.forwarderNonce(appKey.address);
  const gas = ((await publicClient.estimateGas({ account: appKey.address, to, data })) * 12n) / 10n + 30_000n;
  const req = await signForwardRequest(appKey, { chainId: config.chainId, forwarder: deployment.forwarder, to, data, nonce, gas });
  const r = await relay.forward(req);
  if (r.status !== "success") throw new Error(`${functionName} reverted`);
}

async function main() {
  if (!(await relay.info().catch(() => null))) throw new Error(`relay not reachable at ${config.publicUrl}; start it with pnpm relay`);

  // operator account: custody is the relay wallet, app key is the labeler key
  let fid = (await relay.userByCustody(relayAccount.address))?.fid ?? 0;
  if (!fid) {
    const nonce = await relay.signupNonce(relayAccount.address);
    const params = {
      custody: relayAccount.address,
      recovery: relayAccount.address,
      handle: HANDLE,
      keyType: KeyTypes.SECP256K1,
      key: appKey.address.toLowerCase() as Hex,
      scope: Scopes.FULL,
      expiry: 0n,
      clientFid: 0n,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
    };
    const sig = await relayAccount.signTypedData(signupTypedData(config.chainId, deployment.signup, params, nonce));
    fid = (await relay.signup(params, sig)).fid;
    console.log(`[bootstrap] registered @${HANDLE} as fid ${fid}`);
  }
  kvSet("labeler.fid", String(fid));
  kvSet("labelers.default", JSON.stringify([fid]));

  const existing = await relay.feeds();
  if (existing.length) {
    console.log(`[bootstrap] ${existing.length} feeds already registered, skipping`);
    return;
  }
  for (const def of Object.values(DEFAULT_FEEDS)) {
    const uri = dataUri({ name: def.name, description: def.description, definition: def });
    await call(deployment.feeds, feedsAbi, "create", [BigInt(fid), 0, uri, feedHash(def), 0n, 0, Math.round(def.discovery * 10_000)]);
    console.log(`[bootstrap] feed: ${def.name}`);
  }
  // reference hosted feed served by this relay (free); anyone can register their own
  const hosted = {
    name: "High signal",
    description: "Reputable authors with real conversations. Server-ranked.",
    endpoint: `${config.publicUrl}/hosted/high-signal`,
  };
  await call(deployment.feeds, feedsAbi, "create", [BigInt(fid), 1, dataUri(hosted), keccak256(toBytes(JSON.stringify(hosted))), 0n, 0, 1500]);
  console.log(`[bootstrap] feed: ${hosted.name} (hosted)`);
  console.log("[bootstrap] done");
}

main().catch((e) => {
  console.error("[bootstrap]", e.message ?? e);
  process.exit(1);
});
