import { EventEmitter } from "node:events";
import type { Address, Hex } from "viem";
import {
  verifyMessage,
  extractTags,
  extractLinks,
  appKeysAbi,
  communitiesAbi,
  Scopes,
  type SignedMessage,
  type PostBody,
  type ReplyBody,
  type TrialBody,
  type TargetBody,
  type BackBody,
  type ViewBody,
  type ChatBody,
  type LabelBody,
} from "@monsoc/sdk";
import { config } from "./config";
import { get, run, tx } from "./db";
import { publicClient, deployment } from "./chain";

export const bus = new EventEmitter();
bus.setMaxListeners(1000);

export class RejectError extends Error {
  status = 400;
}
const reject = (msg: string): never => {
  throw new RejectError(msg);
};

const MAX_TEXT = 1024;
const MAX_CHAT = 2000;

// ------------------------------------------------------------------ auth helpers

async function signerAuthorized(fid: number, signer: Address, scope: number): Promise<boolean> {
  const row = get<{ scope: number; expiry: number; revoked: number }>(
    "SELECT scope, expiry, revoked FROM app_keys WHERE fid = ? AND signer = ?",
    fid,
    signer.toLowerCase(),
  );
  if (row) {
    if (row.revoked) return false;
    if (row.expiry !== 0 && row.expiry * 1000 < Date.now()) return false;
    return (row.scope & scope) >>> 0 === scope;
  }
  // indexer may lag a just-authorized key by a block: ask the chain
  return publicClient.readContract({
    address: deployment.appKeys,
    abi: appKeysAbi,
    functionName: "isAuthorized",
    args: [BigInt(fid), signer, scope],
  });
}

export async function isMember(community: number, fid: number): Promise<boolean> {
  const row = get<{ role: number; banned: number; expires_at: number }>(
    "SELECT role, banned, expires_at FROM members WHERE community_id = ? AND fid = ?",
    community,
    fid,
  );
  if (row && row.banned) return false;
  if (row && row.role > 0 && (row.expires_at === 0 || row.expires_at > Date.now())) return true;
  return publicClient.readContract({
    address: deployment.communities,
    abi: communitiesAbi,
    functionName: "isMember",
    args: [BigInt(community), BigInt(fid)],
  });
}

const rate = new Map<number, { minute: number; count: number }>();
function rateLimit(fid: number) {
  const minute = Math.floor(Date.now() / 60_000);
  const rep = get<{ rep: number }>("SELECT rep FROM reputation WHERE fid = ?", fid)?.rep ?? 0;
  const limit = Math.round(config.messageRatePerMinute * (1 + 2 * rep));
  const cur = rate.get(fid);
  if (!cur || cur.minute !== minute) rate.set(fid, { minute, count: 1 });
  else if (++cur.count > limit) reject("rate limited");
}

// ------------------------------------------------------------------ ingest

export interface IngestOpts {
  /** messages from peers / escape hatch may be old */
  relaxedTime?: boolean;
  source?: "client" | "peer" | "escape-hatch" | "local";
}

export async function ingest(msg: SignedMessage, opts: IngestOpts = {}): Promise<{ hash: Hex; relaySeq: number; duplicate?: boolean }> {
  if (!msg?.data || !msg.hash || !msg.signature || !msg.signer) reject("malformed message");
  const existing = get<{ relay_seq: number }>("SELECT relay_seq FROM messages WHERE hash = ?", msg.hash);
  if (existing) return { hash: msg.hash, relaySeq: existing.relay_seq, duplicate: true };

  const d = msg.data;
  if (!Number.isInteger(d.fid) || d.fid <= 0) reject("bad fid");
  if (!Number.isInteger(d.seq) || d.seq <= 0) reject("bad seq");
  if (!(await verifyMessage(msg))) reject("bad signature");

  const scope = d.type === "chat" ? Scopes.CHAT : Scopes.POST;
  if (!(await signerAuthorized(d.fid, msg.signer, scope))) reject("signer is not an active app key for this fid");

  if (!opts.relaxedTime) {
    const skew = Math.abs(Date.now() - d.timestamp);
    if (skew > config.maxClockSkewMs) reject("timestamp too far from now");
  }
  const clash = get("SELECT 1 FROM messages WHERE fid = ? AND seq = ? AND hash != ?", d.fid, d.seq, msg.hash);
  if (clash) reject("sequence number already used");
  if (opts.source === "client") rateLimit(d.fid);

  await validateBody(msg);

  const relaySeq = tx(() => {
    const r = run(
      "INSERT INTO messages(hash, fid, type, ts, seq, signer, raw, received_at) VALUES(?,?,?,?,?,?,?,?)",
      msg.hash,
      d.fid,
      d.type,
      d.timestamp,
      d.seq,
      msg.signer.toLowerCase(),
      JSON.stringify(msg),
      Date.now(),
    );
    apply(msg);
    return Number(r.lastInsertRowid);
  });

  bus.emit("message", msg);
  return { hash: msg.hash, relaySeq };
}

async function validateBody(msg: SignedMessage) {
  const { type, fid } = msg.data;
  const b = msg.data.body as unknown as Record<string, unknown>;
  switch (type) {
    case "post":
    case "reply":
    case "trial-post": {
      const p = b as unknown as PostBody;
      if (typeof p.text !== "string" || (p.text.length === 0 && !p.media?.length)) reject("text required");
      if (p.text.length > MAX_TEXT) reject("text too long");
      if (type === "reply") {
        const parent = get("SELECT 1 FROM posts WHERE hash = ? AND deleted = 0", (b as unknown as ReplyBody).parent);
        if (!parent) reject("unknown parent");
      }
      if (type === "trial-post") {
        const t = (b as unknown as TrialBody).trial;
        if (!t || !Array.isArray(t.topics) || t.topics.length === 0) reject("trial needs at least one topic");
        if (t.variant && !t.groupId) reject("variant needs groupId");
      }
      if (p.community !== undefined && !(await isMember(p.community, fid))) reject("not a member of this community");
      break;
    }
    case "like":
    case "repost": {
      if (!get("SELECT 1 FROM posts WHERE hash = ?", (b as unknown as TargetBody).target)) reject("unknown target");
      break;
    }
    case "delete": {
      const t = (b as unknown as TargetBody).target;
      const own =
        get("SELECT 1 FROM posts WHERE hash = ? AND fid = ?", t, fid) ??
        get("SELECT 1 FROM reactions WHERE hash = ? AND fid = ?", t, fid);
      if (!own) reject("can only delete your own messages");
      break;
    }
    case "trial-release": {
      const t = (b as unknown as TargetBody).target;
      if (!get("SELECT 1 FROM posts WHERE hash = ? AND fid = ? AND trial IS NOT NULL", t, fid)) reject("not your trial");
      break;
    }
    case "back": {
      const bb = b as unknown as BackBody;
      if (bb.targetFid === fid) reject("can't back yourself");
      if (!get("SELECT 1 FROM users WHERE fid = ?", bb.targetFid)) reject("unknown creator");
      break;
    }
    case "view": {
      const v = b as unknown as ViewBody;
      if (!get("SELECT 1 FROM posts WHERE hash = ?", v.target)) reject("unknown target");
      break;
    }
    case "chat": {
      const c = b as unknown as ChatBody;
      if (typeof c.text !== "string" || !c.text || c.text.length > MAX_CHAT) reject("bad chat text");
      if (!(await isMember(c.community, fid))) reject("not a member of this community");
      break;
    }
    case "label": {
      const l = b as unknown as LabelBody;
      if (!Array.isArray(l.labels) || l.labels.length === 0) reject("labels required");
      break;
    }
    default:
      reject(`unknown type ${type}`);
  }
}

/** Project a stored message into the read tables. Runs inside the insert transaction. */
function apply(msg: SignedMessage) {
  const { type, fid, timestamp: ts } = msg.data;
  const b = msg.data.body as unknown as Record<string, any>;
  switch (type) {
    case "post":
    case "reply":
    case "trial-post": {
      const p = b as PostBody & Partial<ReplyBody> & Partial<TrialBody>;
      const tags = [...new Set([...(p.tags ?? []).map((t) => t.toLowerCase().replace(/^#/, "")), ...extractTags(p.text)])];
      const links = [...new Set([...(p.links ?? []), ...extractLinks(p.text)])];
      let root: string | null = null;
      let depth = 0;
      if (p.parent) {
        const parent = get<{ hash: string; root: string | null; depth: number }>(
          "SELECT hash, root, depth FROM posts WHERE hash = ?",
          p.parent,
        )!;
        root = parent.root ?? parent.hash;
        depth = parent.depth + 1;
      }
      run(
        `INSERT INTO posts(hash, fid, type, ts, text, tags, links, media, community, parent, root, depth, trial, trial_status, trial_group)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        msg.hash,
        fid,
        type,
        ts,
        p.text,
        JSON.stringify(tags),
        JSON.stringify(links),
        JSON.stringify(p.media ?? []),
        p.community ?? null,
        p.parent ?? null,
        root,
        depth,
        p.trial ? JSON.stringify(p.trial) : null,
        p.trial ? "testing" : null,
        p.trial?.groupId ?? null,
      );
      for (const t of tags) run("INSERT OR IGNORE INTO post_tags(hash, tag) VALUES(?,?)", msg.hash, t);
      break;
    }
    case "like":
    case "repost":
      run("INSERT OR IGNORE INTO reactions(hash, fid, type, target, ts) VALUES(?,?,?,?,?)", msg.hash, fid, type, b.target, ts);
      break;
    case "delete":
      run("UPDATE posts SET deleted = 1 WHERE hash = ? AND fid = ?", b.target, fid);
      run("DELETE FROM reactions WHERE hash = ? AND fid = ?", b.target, fid);
      run("UPDATE posts SET trial_status = 'dropped' WHERE hash = ? AND fid = ? AND trial IS NOT NULL", b.target, fid);
      break;
    case "trial-release": {
      run("UPDATE posts SET trial_status = 'released' WHERE hash = ? AND fid = ?", b.target, fid);
      // releasing one A/B variant drops the other
      const g = get<{ trial_group: string | null }>("SELECT trial_group FROM posts WHERE hash = ?", b.target);
      if (g?.trial_group)
        run(
          "UPDATE posts SET trial_status = 'dropped' WHERE trial_group = ? AND fid = ? AND hash != ? AND trial_status = 'testing'",
          g.trial_group,
          fid,
          b.target,
        );
      break;
    }
    case "back":
      run("INSERT OR IGNORE INTO backs(fid, creator, target, ts) VALUES(?,?,?,?)", fid, b.targetFid, b.target ?? null, ts);
      break;
    case "view": {
      const creator = get<{ fid: number }>("SELECT fid FROM posts WHERE hash = ?", b.target)!.fid;
      run(
        `INSERT OR IGNORE INTO views(hash, fid, target, creator, feed_id, ts, dwell_ms, completion) VALUES(?,?,?,?,?,?,?,?)`,
        msg.hash,
        fid,
        b.target,
        creator,
        b.feedId ?? 0,
        ts,
        b.dwellMs ?? 0,
        b.completion ?? 0,
      );
      break;
    }
    case "chat":
      run(
        "INSERT INTO chat(hash, community, room, fid, ts, raw) VALUES(?,?,?,?,?,?)",
        msg.hash,
        b.community,
        b.room,
        fid,
        ts,
        JSON.stringify(msg),
      );
      break;
    case "label":
      for (const l of b.labels as string[]) {
        if (b.neg) run("DELETE FROM labels WHERE target = ? AND labeler = ? AND label = ?", b.target, fid, l);
        else run("INSERT OR IGNORE INTO labels(target, labeler, label, ts) VALUES(?,?,?,?)", b.target, fid, l, ts);
      }
      break;
  }
}
