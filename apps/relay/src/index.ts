import { serve } from "@hono/node-server";
import { app } from "./api";
import { config } from "./config";
import { relayAccount, deployment } from "./chain";
import { startIndexer } from "./indexer";
import { startAnchoring } from "./anchor";
import { startJobs } from "./jobs";

startIndexer();
startAnchoring();
startJobs();

serve({ fetch: app.fetch, port: config.port }, () => {
  console.log(`[relay] listening on ${config.publicUrl}`);
  console.log(`[relay] chain ${config.chainId} via ${config.rpcUrl}, relay wallet ${relayAccount.address}`);
  console.log(`[relay] anchor contract ${deployment.anchor}, interval ${config.anchorIntervalMs / 1000}s`);
});
