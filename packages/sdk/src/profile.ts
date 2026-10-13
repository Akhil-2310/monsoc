import { PROFILE_LIMITS, type ProfileBody } from "./types";

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

/** ipfs:// → public gateway URL for display. */
export function mediaUrl(uri: string, gateway = "https://ipfs.io/ipfs/"): string {
  return uri.startsWith("ipfs://") ? gateway + uri.slice(7) : uri;
}
