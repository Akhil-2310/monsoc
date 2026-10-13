/**
 * Reputation and scout scores. These are pure functions over public data (onchain follow events with
 * timestamps + anchored messages), so anyone can rerun them and compare against the posted root.
 */

export interface AccountStats {
  fid: number;
  createdAt: number; // ms
  posts: number;
  followers: number;
  /** followers who are themselves reputable (computed in a previous pass) */
  reputableFollowers?: number;
  /** optional identity proof (Gitcoin Passport / World ID) */
  verifiedHuman?: boolean;
}

export const REPUTATION_VERIFIED = 0.5;

/** 0..1. Account age, real activity and follows from trusted accounts raise it. */
export function reputation(a: AccountStats, now = Date.now()): number {
  const ageDays = (now - a.createdAt) / 86_400_000;
  const age = Math.min(1, ageDays / 7);
  const activity = Math.min(1, a.posts / 5);
  const trust = Math.min(1, (a.reputableFollowers ?? a.followers / 2) / 5);
  const human = a.verifiedHuman ? 0.3 : 0;
  return Math.min(1, 0.35 * age + 0.3 * activity + 0.35 * trust + human);
}

export interface Backing {
  scout: number;
  creator: number;
  /** ms; earliest of follow, Back, or engagement with the creator */
  at: number;
}

export interface ScoutInputs {
  backings: Backing[];
  /** verified (reputation-weighted) follower count of `creator` at time `at` */
  verifiedFollowersAt: (creator: number, at: number) => number;
  verifiedFollowersNow: (creator: number) => number;
  reputationOf: (fid: number) => number;
  /** only the first N backings per scout per day count */
  dailyLimit?: number;
}

export interface ScoutScore {
  fid: number;
  score: number; // integer, x1000
  backed: number;
  hits: number;
  topFinds: { creator: number; at: number; from: number; now: number; points: number }[];
}

/**
 * Score rises the earlier you backed a creator relative to how much they later grew: backing at 200
 * verified followers someone who reaches 20k is worth log2(20k/200) ≈ 6.6 points; backing at 15k
 * is worth ~0.4. Score rewards hit rate, not volume.
 */
export function computeScoutScores(inputs: ScoutInputs): ScoutScore[] {
  const limit = inputs.dailyLimit ?? 20;
  const byScout = new Map<number, Backing[]>();
  for (const b of inputs.backings) {
    if (b.scout === b.creator) continue;
    if (inputs.reputationOf(b.scout) < REPUTATION_VERIFIED) continue; // low-rep accounts filtered
    const list = byScout.get(b.scout) ?? [];
    list.push(b);
    byScout.set(b.scout, list);
  }

  const out: ScoutScore[] = [];
  for (const [scout, list] of byScout) {
    // earliest backing per creator, then daily limit
    const earliest = new Map<number, Backing>();
    for (const b of list) {
      const cur = earliest.get(b.creator);
      if (!cur || b.at < cur.at) earliest.set(b.creator, b);
    }
    const perDay = new Map<number, number>();
    const counted = [...earliest.values()]
      .sort((a, b) => a.at - b.at)
      .filter((b) => {
        const day = Math.floor(b.at / 86_400_000);
        const n = (perDay.get(day) ?? 0) + 1;
        perDay.set(day, n);
        return n <= limit;
      });

    let points = 0;
    let hits = 0;
    const finds: ScoutScore["topFinds"] = [];
    for (const b of counted) {
      const from = inputs.verifiedFollowersAt(b.creator, b.at);
      const now = inputs.verifiedFollowersNow(b.creator);
      const growth = Math.log2((now + 1) / (from + 1));
      if (growth <= 0) continue;
      if (growth >= 1) hits++; // creator at least doubled since you backed them
      points += growth;
      finds.push({ creator: b.creator, at: b.at, from, now, points: growth });
    }
    const hitRate = counted.length ? hits / counted.length : 0;
    // blend: raw points, scaled by hit rate so spraying backs everywhere doesn't pay
    const score = Math.round(points * (0.25 + 0.75 * hitRate) * 1000);
    finds.sort((a, b) => b.points - a.points);
    out.push({ fid: scout, score, backed: counted.length, hits, topFinds: finds.slice(0, 5) });
  }
  return out.sort((a, b) => b.score - a.score);
}

export function scoutTier(score: number): string | null {
  if (score >= 20_000) return "Legend";
  if (score >= 8_000) return "Gold";
  if (score >= 3_000) return "Silver";
  if (score >= 500) return "Bronze";
  return null;
}
