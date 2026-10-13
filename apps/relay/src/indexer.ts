import { decodeEventLog, hexToString, type Abi, type Address, type Log } from "viem";
import {
  identityAbi,
  appKeysAbi,
  followsAbi,
  feedsAbi,
  paymentsAbi,
  anchorAbi,
  communitiesAbi,
  type SignedMessage,
} from "@monsoc/sdk";
import { publicClient, deployment } from "./chain";
import { config } from "./config";
import { kvGet, kvSet, run, tx } from "./db";
import { ingest } from "./messages";

/**
 * Turns contract events into Postgres-style tables (SQLite here) for the read API.
 * In production, Envio can index the same events; this keeps the demo dependency-free.
 */

const sources: Record<string, Abi> = {
  [deployment.identity.toLowerCase()]: identityAbi as Abi,
  [deployment.appKeys.toLowerCase()]: appKeysAbi as Abi,
  [deployment.follows.toLowerCase()]: followsAbi as Abi,
  [deployment.feeds.toLowerCase()]: feedsAbi as Abi,
  [deployment.payments.toLowerCase()]: paymentsAbi as Abi,
  [deployment.anchor.toLowerCase()]: anchorAbi as Abi,
  [deployment.communities.toLowerCase()]: communitiesAbi as Abi,
};

const blockTimes = new Map<bigint, number>();
async function blockTime(n: bigint): Promise<number> {
  let t = blockTimes.get(n);
  if (t === undefined) {
    const b = await publicClient.getBlock({ blockNumber: n });
    t = Number(b.timestamp) * 1000;
    blockTimes.set(n, t);
    if (blockTimes.size > 5000) blockTimes.delete(blockTimes.keys().next().value!);
  }
  return t;
}

/** Resolve feed / community metadata from data:, ipfs:// or https:// URIs. */
export async function resolveUri(uri: string): Promise<Record<string, unknown> | null> {
  try {
    if (uri.startsWith("data:")) {
      const [head, body] = uri.split(",", 2) as [string, string];
      const text = head.endsWith(";base64") ? Buffer.from(body, "base64").toString("utf8") : decodeURIComponent(body);
      return JSON.parse(text);
    }
    const url = uri.startsWith("ipfs://") ? config.ipfsGateway + uri.slice(7) : uri;
    if (!url.startsWith("http")) return null;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    return res.ok ? ((await res.json()) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

type Decoded = { eventName: string; args: Record<string, unknown> };

async function handle(log: Log, ev: Decoded) {
  const a = ev.args as Record<string, any>;
  const at = await blockTime(log.blockNumber!);
  const n = (v: unknown) => Number(v as bigint);

  switch (ev.eventName) {
    // ------------------------------------------------ identity
    case "Registered":
      run(
        "INSERT OR REPLACE INTO users(fid, custody, recovery, handle, created_at) VALUES(?,?,?,NULL,?)",
        n(a.fid),
        (a.custody as string).toLowerCase(),
        (a.recovery as string).toLowerCase(),
        at,
      );
      break;
    case "Transferred":
      run("UPDATE users SET custody = ? WHERE fid = ?", (a.to as string).toLowerCase(), n(a.fid));
      break;
    case "RecoverySet":
      run("UPDATE users SET recovery = ? WHERE fid = ?", (a.recovery as string).toLowerCase(), n(a.fid));
      break;
    case "HandleSet":
      run("UPDATE users SET handle = ? WHERE fid = ?", a.handle || null, n(a.fid));
      break;

    // ------------------------------------------------ app keys
    case "KeyAdded": {
      const key = a.key as `0x${string}`;
      const signer = Number(a.keyType) === 1 ? key.toLowerCase() : null;
      run(
        `INSERT OR REPLACE INTO app_keys(fid, key_hash, key_type, key, signer, scope, expiry, client_fid, revoked)
         VALUES(?,?,?,?,?,?,?,?,0)`,
        n(a.fid),
        a.keyHash,
        Number(a.keyType),
        key,
        signer,
        Number(a.scope),
        n(a.expiry),
        n(a.clientFid),
      );
      break;
    }
    case "KeyRevoked":
      run("UPDATE app_keys SET revoked = 1 WHERE fid = ? AND key_hash = ?", n(a.fid), a.keyHash);
      break;

    // ------------------------------------------------ follows
    case "Followed":
      run("INSERT OR IGNORE INTO follows(fid, target, ts) VALUES(?,?,?)", n(a.fid), n(a.target), n(a.timestamp) * 1000);
      break;
    case "Unfollowed":
      run("DELETE FROM follows WHERE fid = ? AND target = ?", n(a.fid), n(a.target));
      break;

    // ------------------------------------------------ feeds
    case "FeedCreated": {
      const meta = await resolveUri(a.uri);
      run(
        `INSERT OR REPLACE INTO feeds(id, owner_fid, kind, uri, def_hash, meta) VALUES(?,?,?,?,?,?)`,
        n(a.feedId),
        n(a.ownerFid),
        Number(a.kind),
        a.uri,
        a.defHash,
        JSON.stringify(meta),
      );
      break;
    }
    case "FeedUpdated": {
      const meta = await resolveUri(a.uri);
      run(
        "UPDATE feeds SET version = ?, uri = ?, def_hash = ?, meta = ? WHERE id = ?",
        Number(a.version),
        a.uri,
        a.defHash,
        JSON.stringify(meta),
        n(a.feedId),
      );
      run(
        "INSERT OR REPLACE INTO feed_versions(feed_id, version, uri, def_hash, at) VALUES(?,?,?,?,?)",
        n(a.feedId),
        Number(a.version),
        a.uri,
        a.defHash,
        at,
      );
      break;
    }
    case "FeedPricingSet":
      run(
        "UPDATE feeds SET price_usd = ?, creator_share_bps = ? WHERE id = ?",
        n(a.priceUsd),
        Number(a.creatorShareBps),
        n(a.feedId),
      );
      break;
    case "FeedDiscoverySet":
      run("UPDATE feeds SET discovery_bps = ? WHERE id = ?", Number(a.discoveryBps), n(a.feedId));
      break;
    case "FeedActiveSet":
      run("UPDATE feeds SET active = ? WHERE id = ?", a.active ? 1 : 0, n(a.feedId));
      break;
    case "FeedTransferred":
      run("UPDATE feeds SET owner_fid = ? WHERE id = ?", n(a.toFid), n(a.feedId));
      break;

    // ------------------------------------------------ payments
    case "Subscribed":
      run(
        "INSERT OR REPLACE INTO subscriptions(fid, feed_id, until) VALUES(?,?,?)",
        n(a.subscriberFid),
        n(a.feedId),
        n(a.until) * 1000,
      );
      run(
        `INSERT OR IGNORE INTO sub_payments(tx, log_index, subscriber_fid, feed_id, token, amount, to_creators, epoch, at)
         VALUES(?,?,?,?,?,?,?,?,?)`,
        log.transactionHash!,
        log.logIndex!,
        n(a.subscriberFid),
        n(a.feedId),
        (a.token as string).toLowerCase(),
        String(a.amount),
        String(a.toCreators),
        n(a.epoch),
        at,
      );
      break;
    case "PayoutClaimed":
      run(
        "UPDATE payout_leaves SET claimed = 1 WHERE epoch = ? AND token = ? AND fid = ?",
        n(a.epoch),
        (a.token as string).toLowerCase(),
        n(a.fid),
      );
      break;

    // ------------------------------------------------ anchor escape hatch
    case "EscapeHatch": {
      try {
        const msg = JSON.parse(hexToString(a.message)) as SignedMessage;
        await ingest(msg, { relaxedTime: true, source: "escape-hatch" });
      } catch (e) {
        console.warn("[indexer] bad escape hatch message", (e as Error).message);
      }
      break;
    }

    // ------------------------------------------------ communities
    case "CommunityCreated":
      run(
        "INSERT OR REPLACE INTO communities(id, owner_fid, join_type, uri) VALUES(?,?,?,?)",
        n(a.cid),
        n(a.ownerFid),
        Number(a.joinType),
        a.uri,
      );
      break;
    case "CommunityUpdated": {
      const meta = await resolveUri(a.uri);
      run(
        "UPDATE communities SET uri = ?, feed_id = ?, meta = ? WHERE id = ?",
        a.uri,
        n(a.feedId),
        JSON.stringify(meta),
        n(a.cid),
      );
      break;
    }
    case "JoinRulesSet":
      run(
        "UPDATE communities SET join_type = ?, gate_token = ?, gate_min = ?, price_usd = ?, period = ? WHERE id = ?",
        Number(a.joinType),
        (a.gateToken as string).toLowerCase(),
        String(a.gateMin),
        n(a.priceUsd),
        n(a.period),
        n(a.cid),
      );
      break;
    case "Joined":
      run(
        `INSERT INTO members(community_id, fid, role, joined_at, expires_at) VALUES(?,?,1,?,?)
         ON CONFLICT(community_id, fid) DO UPDATE SET role = MAX(role, 1), expires_at = excluded.expires_at, banned = 0`,
        n(a.cid),
        n(a.fid),
        at,
        n(a.expiresAt) * 1000,
      );
      break;
    case "Left":
      run("UPDATE members SET role = 0 WHERE community_id = ? AND fid = ?", n(a.cid), n(a.fid));
      break;
    case "RoleSet":
      run("UPDATE members SET role = ? WHERE community_id = ? AND fid = ?", Number(a.role), n(a.cid), n(a.fid));
      break;
    case "CustomRolesSet":
      run("UPDATE members SET custom_roles = ? WHERE community_id = ? AND fid = ?", String(a.mask), n(a.cid), n(a.fid));
      break;
    case "BanSet":
      run(
        `INSERT INTO members(community_id, fid, role, banned, joined_at) VALUES(?,?,0,?,?)
         ON CONFLICT(community_id, fid) DO UPDATE SET banned = excluded.banned`,
        n(a.cid),
        n(a.fid),
        a.banned ? 1 : 0,
        at,
      );
      break;
  }
}

let running = false;

export async function indexOnce(): Promise<number> {
  if (running) return 0;
  running = true;
  try {
    const head = await publicClient.getBlockNumber();
    let from = BigInt(kvGet("indexer.block") ?? String(deployment.startBlock - 1)) + 1n;
    if (from < 0n) from = 0n;
    let handled = 0;
    while (from <= head) {
      const to = from + config.logRange - 1n < head ? from + config.logRange - 1n : head;
      const logs = await publicClient.getLogs({
        address: Object.keys(sources) as Address[],
        fromBlock: from,
        toBlock: to,
      });
      // decode outside the transaction (metadata fetches are async), apply in order
      for (const log of logs) {
        const abi = sources[log.address.toLowerCase()];
        if (!abi) continue;
        let ev: Decoded;
        try {
          ev = decodeEventLog({ abi, data: log.data, topics: log.topics }) as unknown as Decoded;
        } catch {
          continue;
        }
        await handle(log, ev);
        handled++;
      }
      tx(() => kvSet("indexer.block", String(to)));
      from = to + 1n;
    }
    return handled;
  } finally {
    running = false;
  }
}

export function startIndexer() {
  const loop = async () => {
    try {
      const n = await indexOnce();
      if (n) console.log(`[indexer] applied ${n} events`);
    } catch (e) {
      console.error("[indexer]", (e as Error).message);
    }
    setTimeout(loop, config.indexIntervalMs);
  };
  loop();
}
