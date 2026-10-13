import { defineChain, type Chain } from "viem";
import { monadTestnet } from "viem/chains";
import { deployments } from "./generated/deployments";
import type { Deployment } from "./types";

export const localChain = defineChain({
  id: 31337,
  name: "Local (anvil)",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8546"] } },
});

export { monadTestnet };

export const chains: Record<number, Chain> = {
  [localChain.id]: localChain,
  [monadTestnet.id]: monadTestnet,
};

export function getChain(chainId: number): Chain {
  const c = chains[chainId];
  if (!c) throw new Error(`unsupported chain ${chainId}`);
  return c;
}

export function getDeployment(chainId: number): Deployment {
  const d = deployments[chainId];
  if (!d) throw new Error(`no deployment for chain ${chainId}; run pnpm deploy:local or deploy:testnet`);
  return d;
}

export const NATIVE = "0x0000000000000000000000000000000000000000" as const;
