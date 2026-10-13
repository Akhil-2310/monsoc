import { PROFILE_LIMITS, type MediaItem, type ProfileBody } from "./types";

const IMAGE = /^(ipfs:\/\/[a-zA-Z0-9]+[^\s]*|https:\/\/[^\s]+)$/;
const LINK = /^https:\/\/[^\s]+$/;

/** Shared by clients (form feedback) and relays (rejection). Returns human-readable problems. */
export function validateProfile(p: ProfileBody): string[] {
  const errs: string[] = [];
  const allowed = new Set(["displayName", "bio", "avatar", "banner", "url", "location"]);
  for (const k of Object.keys(p)) if (!allowed.has(k)) errs.push(`unknown field ${k}`);
  for (const [k, v] of Object.entries(p)) if (v !== undefined && typeof v !== "string") errs.push(`${k} must be text`);
  if ((p.displayName?.length ?? 0) > PROFILE_LIMITS.displayName) errs.push(`name is over ${PROFILE_LIMITS.displayName} characters`);
  if ((p.bio?.length ?? 0) > PROFILE_LIMITS.bio) errs.push(`bio is over ${PROFILE_LIMITS.bio} characters`);
  if ((p.location?.length ?? 0) > PROFILE_LIMITS.location) errs.push(`location is over ${PROFILE_LIMITS.location} characters`);
  if (p.url && (p.url.length > PROFILE_LIMITS.url || !LINK.test(p.url))) errs.push("website must be an https:// link");
  for (const k of ["avatar", "banner"] as const) {
    const v = p[k];
    if (v && (v.length > PROFILE_LIMITS.image || !IMAGE.test(v))) errs.push(`${k} must be an ipfs:// or https:// image link`);
  }
  return errs;
}

/** Drop empty strings and trim, so clearing a field removes it. */
export function cleanProfile(p: ProfileBody): ProfileBody {
  const out: ProfileBody = {};
  for (const [k, v] of Object.entries(p)) {
    const t = typeof v === "string" ? v.trim() : v;
    if (t) (out as Record<string, string>)[k] = t;
  }
  return out;
}

/**
 * Display URL for a media link: ipfs:// goes through a public gateway; ImageKit links get an on-the-fly
 * resize (tr=w-…,h-…) so avatars and thumbnails don't download full-size originals.
 */
export function mediaUrl(uri: string, opts: { w?: number; h?: number; gateway?: string } = {}): string {
  if (uri.startsWith("ipfs://")) return (opts.gateway ?? "https://ipfs.io/ipfs/") + uri.slice(7);
  if ((opts.w || opts.h) && /^https:\/\/ik\.imagekit\.io\//.test(uri)) {
    const tr = [opts.w && `w-${opts.w}`, opts.h && `h-${opts.h}`, "fo-auto"].filter(Boolean).join(",");
    return `${uri}${uri.includes("?") ? "&" : "?"}tr=${tr}`;
  }
  return uri;
}

/** Media attached to posts: at most 4 items, https/ipfs links only, optional sha256 of the bytes. */
export function validateMedia(media: unknown): string[] {
  if (media === undefined) return [];
  if (!Array.isArray(media)) return ["media must be a list"];
  if (media.length > 4) return ["at most 4 media items"];
  const errs: string[] = [];
  for (const m of media as MediaItem[]) {
    if (!m || typeof m.uri !== "string" || m.uri.length > 500 || !IMAGE.test(m.uri)) errs.push("media must be an ipfs:// or https:// link");
    if (m?.kind !== "image" && m?.kind !== "video") errs.push("media kind must be image or video");
    if (m?.sha256 !== undefined && !/^0x[0-9a-f]{64}$/.test(m.sha256)) errs.push("media sha256 must be 32 bytes hex");
  }
  return errs;
}

/**
 * URL of the exact uploaded bytes. CDNs like ImageKit re-encode for delivery (e.g. PNG → small JPEG),
 * so integrity checks must fetch the original: ImageKit serves it with tr=orig-true.
 */
export function originalMediaUrl(uri: string, gateway?: string): string {
  if (/^https:\/\/ik\.imagekit\.io\//.test(uri)) return `${uri}${uri.includes("?") ? "&" : "?"}tr=orig-true`;
  return mediaUrl(uri, { gateway });
}

/** Re-hash the original file and compare with the sha256 the author signed into the post. */
export async function verifyMedia(item: MediaItem): Promise<"match" | "mismatch" | "no-hash"> {
  if (!item.sha256) return "no-hash";
  const bytes = await fetch(originalMediaUrl(item.uri)).then((r) => {
    if (!r.ok) throw new Error(`fetch failed (${r.status})`);
    return r.arrayBuffer();
  });
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const hex = `0x${[...digest].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
  return hex === item.sha256 ? "match" : "mismatch";
}
