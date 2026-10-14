import { serve } from "@hono/node-server";
import { app } from "./api";
import { config } from "./config";
import { relayAccount, deployment } from "./chain";
import { startIndexer } from "./indexer";
import { startAnchoring } from "./anchor";
import { startJobs } from "./jobs";
import { startKeeper } from "./markets";
import { privateKeyToAccount } from "viem/accounts";
import { appKeysAbi } from "@monsoc/sdk";
import { publicClient } from "./chain";
import { kvGet, kvSet } from "./db";

/** On a fresh database (e.g. a new server), find the default labeler's account from the chain. */
async function initLabeler() {
  if (kvGet("labeler.fid")) return;
  const signer = privateKeyToAccount(config.labelerKey).address;
  const fid = Number(
    await publicClient.readContract({ address: deployment.appKeys, abi: appKeysAbi, functionName: "signerFid", args: [signer] }).catch(() => 0n),
  );
  if (!fid) return console.log("[relay] labeler key isn't registered yet; run pnpm bootstrap");
  kvSet("labeler.fid", String(fid));
  kvSet("labelers.default", JSON.stringify([fid]));
  console.log(`[relay] default labeler is fid ${fid}`);
}
initLabeler();

startIndexer();
startAnchoring();
startJobs();
startKeeper();

serve({ fetch: app.fetch, port: config.port }, () => {
  console.log(`[relay] listening on ${config.publicUrl}`);
  console.log(`[relay] chain ${config.chainId} via ${config.rpcUrl}, relay wallet ${relayAccount.address}`);
  console.log(`[relay] anchor contract ${deployment.anchor}, interval ${config.anchorIntervalMs / 1000}s`);
});
