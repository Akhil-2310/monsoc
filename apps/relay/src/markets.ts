import type { Abi, Address } from "viem";
import { marketsAbi } from "@monsoc/sdk";
import { all, get } from "./db";
import { deployment, publicClient, send } from "./chain";
import { handleOf, profile } from "./views";

/**
 * Market keeper. Settlement is permissionless and verified onchain (the contract checks every follow
 * against FollowGraph), so this is a convenience, not a trusted oracle: anyone can run the same calls.
 *  - counts eligible followers as they appear (YES settles the moment the target is reached)
 *  - uncounts followers who unfollowed
 *  - resolves NO once the deadline passes
 */
let busy = false;

export async function runKeeper() {
  if (!deployment.markets || busy) return;
  busy = true;
  try {
    const open = all<{ id: number; creator_fid: number; max_fid: number; deadline: number }>(
      "SELECT id, creator_fid, max_fid, deadline FROM markets WHERE outcome = 0",
    );
    for (const m of open) {
      const call = (functionName: string, args: readonly unknown[]) =>
        send({ address: deployment.markets!, abi: marketsAbi as Abi, functionName, args });

      if (Date.now() >= m.deadline) {
        await call("resolve", [BigInt(m.id)]);
        console.log(`[markets] #${m.id} deadline passed, resolved`);
        continue;
      }
      const fresh = all<{ fid: number }>(
        `SELECT f.fid FROM follows f
         WHERE f.target = ? AND f.fid <= ? AND f.fid != ?
           AND f.fid NOT IN (SELECT follower_fid FROM market_counted WHERE market_id = ?)
         LIMIT 200`,
        m.creator_fid,
        m.max_fid,
        m.creator_fid,
        m.id,
      ).map((r) => BigInt(r.fid));
      if (fresh.length) {
        await call("countFollowers", [BigInt(m.id), fresh]);
        console.log(`[markets] #${m.id} counted ${fresh.length} follower(s)`);
      }
      const gone = all<{ follower_fid: number }>(
        `SELECT c.follower_fid FROM market_counted c
         WHERE c.market_id = ? AND NOT EXISTS (SELECT 1 FROM follows f WHERE f.fid = c.follower_fid AND f.target = ?)
         LIMIT 200`,
        m.id,
        m.creator_fid,
      ).map((r) => BigInt(r.follower_fid));
      if (gone.length) {
        await call("uncountFollowers", [BigInt(m.id), gone]);
        console.log(`[markets] #${m.id} uncounted ${gone.length} unfollower(s)`);
      }
    }
  } catch (e) {
    console.error("[markets]", (e as Error).message.split("\n")[0]);
  } finally {
    busy = false;
  }
}

export function startKeeper() {
  if (!deployment.markets) return;
  const loop = async () => {
    await runKeeper();
    setTimeout(loop, 5_000);
  };
  setTimeout(loop, 3_000);
}

// ------------------------------------------------------------------ read model

const OUTCOME = ["open", "yes", "no", "void"] as const;

interface MarketRow {
  id: number;
  creator_fid: number;
  opener_fid: number;
  target: number;
  opened_at: number;
  deadline: number;
  max_fid: number;
  counted: number;
  outcome: number;
  resolved_at: number | null;
  yes_pool: string;
  no_pool: string;
  yes_weight: string;
  no_weight: string;
  creator_fee: string;
  stakers: number;
}

const MARKET_SELECT = `SELECT m.*, (SELECT COUNT(DISTINCT fid) FROM market_stakes s WHERE s.market_id = m.id) AS stakers FROM markets m`;

function toMarket(r: MarketRow) {
  const yes = BigInt(r.yes_pool);
  const no = BigInt(r.no_pool);
  const total = yes + no;
  const creator = profile(r.creator_fid);
  return {
    id: r.id,
    creator: creator && {
      fid: creator.fid,
      handle: creator.handle,
      displayName: creator.displayName,
      avatar: creator.avatar,
      followers: creator.followers,
    },
    openerFid: r.opener_fid,
    openerHandle: handleOf(r.opener_fid),
    target: r.target,
    openedAt: r.opened_at,
    deadline: r.deadline,
    maxFid: r.max_fid,
    counted: r.counted,
    outcome: OUTCOME[r.outcome] ?? "open",
    resolvedAt: r.resolved_at,
    yesPool: r.yes_pool,
    noPool: r.no_pool,
    yesWeight: r.yes_weight,
    noWeight: r.no_weight,
    /** share of money on YES, 0..1 (0.5 when empty) */
    yesShare: total === 0n ? 0.5 : Number((yes * 10_000n) / total) / 10_000,
    creatorFee: r.creator_fee,
    stakers: r.stakers,
  };
}

export function listMarkets(opts: { status?: string; creator?: number; fid?: number }) {
  const where: string[] = [];
  const args: number[] = [];
  if (opts.status === "open") where.push("m.outcome = 0");
  if (opts.status === "resolved") where.push("m.outcome != 0");
  if (opts.creator) where.push("m.creator_fid = ?") && args.push(opts.creator);
  if (opts.fid) where.push("m.id IN (SELECT market_id FROM market_stakes WHERE fid = ?)") && args.push(opts.fid);
  const sql = `${MARKET_SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY m.outcome = 0 DESC, m.deadline ASC LIMIT 100`;
  return all<MarketRow>(sql, ...args).map(toMarket);
}

export async function marketDetail(id: number, viewer?: number) {
  const r = get<MarketRow>(`${MARKET_SELECT} WHERE m.id = ?`, id);
  if (!r) return null;
  const stakes = all<{ fid: number; yes: number; amount: string; weight: string; at: number }>(
    "SELECT fid, yes, amount, weight, at FROM market_stakes WHERE market_id = ? ORDER BY at ASC",
    id,
  ).map((s) => ({ ...s, yes: !!s.yes, handle: handleOf(s.fid) }));
  let position = null;
  if (viewer && deployment.markets) {
    const [p, payout] = await Promise.all([
      publicClient.readContract({ address: deployment.markets, abi: marketsAbi, functionName: "positions", args: [BigInt(id), BigInt(viewer)] }),
      publicClient.readContract({ address: deployment.markets, abi: marketsAbi, functionName: "payoutOf", args: [BigInt(id), BigInt(viewer)] }),
    ]);
    const [yesStake, noStake, yesWeight, noWeight, , claimed] = p as readonly [bigint, bigint, bigint, bigint, Address, boolean];
    position = {
      yesStake: String(yesStake),
      noStake: String(noStake),
      yesWeight: String(yesWeight),
      noWeight: String(noWeight),
      claimed,
      payout: String(payout),
    };
  }
  const multiplier = deployment.markets
    ? Number(
        await publicClient.readContract({ address: deployment.markets, abi: marketsAbi, functionName: "currentMultiplier", args: [BigInt(id)] }),
      ) / 1e18
    : 1;
  return { ...toMarket(r), stakes, position, multiplier };
}

export async function creatorMarketInfo(fid: number) {
  const opt = get<{ opted_in: number }>("SELECT opted_in FROM market_optins WHERE fid = ?", fid);
  const fees = deployment.markets
    ? await publicClient.readContract({ address: deployment.markets, abi: marketsAbi, functionName: "creatorFees", args: [BigInt(fid)] })
    : 0n;
  return { enabled: !!deployment.markets, optedIn: !!opt?.opted_in, creatorFees: String(fees) };
}
