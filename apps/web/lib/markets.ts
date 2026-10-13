"use client";
import { erc20Abi, maxUint256, type Address, type Hex } from "viem";
import { marketsAbi, tusdAbi, type MarketInfo } from "@monsoc/sdk";
import { deployment, publicClient, relay } from "./session";

export const FEE = 0.02; // 1% creator + 1% protocol, taken from the losing pool
export const toUsd = (micro: string | number | bigint) => Number(micro) / 1e6;
export const fmtUsd = (micro: string | number | bigint) => {
  const v = toUsd(micro);
  return `$${v >= 100 ? v.toFixed(0) : v.toFixed(2)}`;
};

export function timeLeft(deadline: number): string {
  const s = Math.max(0, Math.floor((deadline - Date.now()) / 1000));
  if (s === 0) return "ended";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h left` : h ? `${h}h ${m}m left` : `${m}m left`;
}

/** What `amount` (USD) on `side` would return if that side wins, given the pools right now. */
export function estimatePayout(m: MarketInfo, side: "yes" | "no", amount: number, multiplier: number): number {
  const stake = amount * 1e6;
  const w = stake * multiplier;
  const sideWeight = Number(side === "yes" ? m.yesWeight : m.noWeight) + w;
  const otherPool = Number(side === "yes" ? m.noPool : m.yesPool);
  return (stake + otherPool * (1 - FEE) * (w / sideWeight)) / 1e6;
}

/**
 * Stake through the gas sponsor: make sure the app key holds enough testnet tUSD, approve once, stake.
 * `call` is the session's sponsored-call helper.
 */
export async function placeStake(
  call: (to: Address, abi: readonly unknown[], fn: string, args: readonly unknown[]) => Promise<Hex>,
  appKey: Address,
  fid: number,
  marketId: number,
  yes: boolean,
  amountUsd: number,
) {
  const markets = deployment.markets!;
  const amount = BigInt(Math.round(amountUsd * 1e6));
  const [bal, allowance] = await Promise.all([
    publicClient.readContract({ address: deployment.tusd, abi: erc20Abi, functionName: "balanceOf", args: [appKey] }),
    publicClient.readContract({ address: deployment.tusd, abi: erc20Abi, functionName: "allowance", args: [appKey, markets] }),
  ]);
  if (bal < amount) {
    await relay.faucet(appKey); // testnet only: 100 tUSD
    if (amount > bal + 100_000_000n) throw new Error("Testnet faucet gives 100 tUSD at a time; stake less");
  }
  if (allowance < amount) await call(deployment.tusd, tusdAbi, "approve", [markets, maxUint256]);
  await call(markets, marketsAbi, "stake", [BigInt(marketId), BigInt(fid), yes, amount]);
}
