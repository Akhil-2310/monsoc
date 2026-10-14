import type { Hex } from "viem";
import { scoutTier, type PostView, type Profile } from "@monsoc/sdk";
import { all, get, kvGet } from "./db";

export function defaultLabelers(): number[] {
  return JSON.parse(kvGet("labelers.default") ?? "[]");
}

const POST_SELECT = (labelers: number[], viewer: number) => `
SELECT p.*, u.handle, pr.display_name, pr.avatar,
  (SELECT r.hash FROM reactions r WHERE r.target = p.hash AND r.fid = ${viewer} AND r.type = 'like') AS v_like,
  (SELECT r.hash FROM reactions r WHERE r.target = p.hash AND r.fid = ${viewer} AND r.type = 'repost') AS v_repost,
  (SELECT 1 FROM backs b WHERE b.fid = ${viewer} AND b.creator = p.fid) AS v_backed,
  (SELECT COUNT(*) FROM reactions r WHERE r.target = p.hash AND r.type = 'like') AS likes,
  (SELECT COUNT(*) FROM reactions r WHERE r.target = p.hash AND r.type = 'repost') AS reposts,
  (SELECT COUNT(*) FROM posts c WHERE c.parent = p.hash AND c.deleted = 0) AS replies,
  (SELECT COUNT(*) FROM backs b WHERE b.target = p.hash) AS backs,
  (SELECT COUNT(*) FROM views v WHERE v.target = p.hash) AS views,
  MAX(0, COALESCE((SELECT MAX(c.depth) FROM posts c WHERE c.root = COALESCE(p.root, p.hash) AND c.deleted = 0), 0) - p.depth) AS conv_depth,
  (SELECT COUNT(*) FROM follows f WHERE f.target = p.fid) AS author_followers,
  COALESCE(rep.rep, 0) AS author_rep,
  (SELECT GROUP_CONCAT(DISTINCT l.label) FROM labels l WHERE l.target = p.hash AND (
      l.labeler IN (${labelers.map(Number).join(",") || "0"})
      OR (p.community IS NOT NULL AND l.labeler IN (SELECT m.fid FROM members m WHERE m.community_id = p.community AND m.role >= 2))
  )) AS label_list,
  (SELECT m.anchor_batch FROM messages m WHERE m.hash = p.hash) AS anchor_batch
FROM posts p
LEFT JOIN users u ON u.fid = p.fid
LEFT JOIN profiles pr ON pr.fid = p.fid
LEFT JOIN reputation rep ON rep.fid = p.fid
`;

interface PostRow {
  hash: Hex;
  fid: number;
  type: PostView["type"];
  ts: number;
  text: string;
  tags: string;
  links: string;
  media: string;
  community: number | null;
  parent: Hex | null;
  market: number | null;
  trial: string | null;
  trial_status: "testing" | "released" | "dropped" | null;
  handle: string | null;
  display_name: string | null;
  avatar: string | null;
  likes: number;
  reposts: number;
  replies: number;
  backs: number;
  views: number;
  conv_depth: number;
  author_followers: number;
  author_rep: number;
  label_list: string | null;
  anchor_batch: number | null;
  v_like: Hex | null;
  v_repost: Hex | null;
  v_backed: number | null;
}

function toView(r: PostRow, viewer: number): PostView {
  return {
    hash: r.hash,
    fid: r.fid,
    handle: r.handle,
    displayName: r.display_name,
    avatar: r.avatar,
    type: r.type,
    timestamp: r.ts,
    text: r.text,
    tags: JSON.parse(r.tags),
    links: JSON.parse(r.links),
    media: JSON.parse(r.media),
    community: r.community,
    parent: r.parent,
    market: r.market ?? null,
    labels: r.label_list ? r.label_list.split(",") : [],
    trial: r.trial ? { ...JSON.parse(r.trial), status: r.trial_status } : null,
    stats: {
      likes: r.likes,
      replies: r.replies,
      reposts: r.reposts,
      backs: r.backs,
      views: r.views,
      depth: r.conv_depth,
    },
    authorFollowers: r.author_followers,
    authorReputation: r.author_rep,
    anchored: r.anchor_batch !== null,
    ...(viewer ? { viewer: { like: r.v_like, repost: r.v_repost, backed: !!r.v_backed } } : {}),
  };
}

/** Accounts hidden from `viewer`: ones they muted or blocked, and ones who blocked them. */
export const hiddenFor = (viewer: number) =>
  viewer
    ? `(SELECT target FROM relations WHERE fid = ${viewer} UNION SELECT fid FROM relations WHERE target = ${viewer} AND kind = 'block')`
    : "(SELECT -1)";

export function queryPosts(
  where: string,
  args: (string | number)[],
  opts: { order?: string; limit?: number; labelers?: number[]; viewer?: number } = {},
): PostView[] {
  const viewer = Math.max(0, Math.floor(Number(opts.viewer) || 0)); // integer, safe to inline
  const sql = `${POST_SELECT(opts.labelers ?? defaultLabelers(), viewer)} WHERE p.deleted = 0 AND p.fid NOT IN ${hiddenFor(viewer)} AND (${where}) ORDER BY ${opts.order ?? "p.ts DESC"} LIMIT ${opts.limit ?? 200}`;
  return all<PostRow>(sql, ...args).map((r) => toView(r, viewer));
}

export function postsByHash(hashes: string[], labelers?: number[], viewer?: number): PostView[] {
  if (hashes.length === 0) return [];
  const byHash = new Map(
    queryPosts(`p.hash IN (${hashes.map(() => "?").join(",")})`, hashes, { limit: hashes.length, labelers, viewer }).map((p) => [
      p.hash,
      p,
    ]),
  );
  return hashes.map((h) => byHash.get(h as Hex)).filter((p): p is PostView => !!p);
}

// ------------------------------------------------------------------ profiles

interface ProfileRow {
  fid: number;
  custody: string;
  recovery: string | null;
  handle: string | null;
  created_at: number;
  followers: number;
  following: number;
  rep: number | null;
  verified_followers: number | null;
  score: number | null;
  display_name: string | null;
  bio: string | null;
  avatar: string | null;
  banner: string | null;
  url: string | null;
  location: string | null;
}

const PROFILE_SELECT = `
SELECT u.fid, u.custody, u.recovery, u.handle, u.created_at,
  (SELECT COUNT(*) FROM follows f WHERE f.target = u.fid) AS followers,
  (SELECT COUNT(*) FROM follows f WHERE f.fid = u.fid) AS following,
  r.rep, r.verified_followers, s.score,
  pr.display_name, pr.bio, pr.avatar, pr.banner, pr.url, pr.location
FROM users u
LEFT JOIN profiles pr ON pr.fid = u.fid
LEFT JOIN reputation r ON r.fid = u.fid
LEFT JOIN scout_scores s ON s.fid = u.fid
`;

function toProfile(r: ProfileRow): Profile {
  const score = r.score ?? 0;
  return {
    fid: r.fid,
    custody: r.custody as Profile["custody"],
    recovery: (r.recovery as Profile["recovery"]) ?? null,
    handle: r.handle,
    followers: r.followers,
    following: r.following,
    verifiedFollowers: r.verified_followers ?? 0,
    reputation: r.rep ?? 0,
    scoutScore: score,
    scoutTier: scoutTier(score),
    createdAt: r.created_at,
    displayName: r.display_name,
    bio: r.bio,
    avatar: r.avatar,
    banner: r.banner,
    url: r.url,
    location: r.location,
  };
}

export function profile(fidOrHandle: number | string): Profile | null {
  const isFid = typeof fidOrHandle === "number" || /^\d+$/.test(fidOrHandle);
  const row = isFid
    ? get<ProfileRow>(`${PROFILE_SELECT} WHERE u.fid = ?`, Number(fidOrHandle))
    : get<ProfileRow>(`${PROFILE_SELECT} WHERE u.handle = ?`, String(fidOrHandle).replace(/^@/, "").toLowerCase());
  return row ? toProfile(row) : null;
}

export function profiles(where: string, args: (string | number)[], order = "followers DESC", limit = 100): Profile[] {
  // note: `pr` (profiles) is joined in PROFILE_SELECT, so callers may filter on pr.display_name
  return all<ProfileRow>(`${PROFILE_SELECT} WHERE ${where} ORDER BY ${order} LIMIT ${limit}`, ...args).map(toProfile);
}

export function handleOf(fid: number): string | null {
  return get<{ handle: string | null }>("SELECT handle FROM users WHERE fid = ?", fid)?.handle ?? null;
}
