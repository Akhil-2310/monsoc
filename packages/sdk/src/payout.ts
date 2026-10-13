/**
 * Subscription payout allocation (user-centric). Each subscriber's creator share for a feed is split
 * across the creators *they* viewed and engaged with in that feed, using views signed by the
 * subscriber's own app key, so a hosted feed can't lie about whom it surfaced.
 */

export interface SubscriptionPayment {
  subscriberFid: number;
  feedId: number;
  token: string;
  /** amount routed to the creator pool by the Payments contract */
  toCreators: bigint;
}

export interface Engagement {
  subscriberFid: number;
  feedId: number;
  creatorFid: number;
  views: number;
  likes: number;
  replies: number;
}

export interface Allocation {
  fid: number;
  token: string;
  amount: bigint;
}

export function allocatePayouts(
  payments: SubscriptionPayment[],
  engagement: Engagement[],
  opts: { reputationOf: (fid: number) => number; minReputation?: number; feedOwnerOf?: (feedId: number) => number },
): Allocation[] {
  const minRep = opts.minReputation ?? 0.3;
  const totals = new Map<string, bigint>(); // `${fid}|${token}` -> amount

  for (const pay of payments) {
    if (opts.reputationOf(pay.subscriberFid) < minRep) continue; // farms earn little
    const rows = engagement.filter(
      (e) =>
        e.subscriberFid === pay.subscriberFid &&
        e.feedId === pay.feedId &&
        e.creatorFid !== pay.subscriberFid &&
        e.creatorFid !== opts.feedOwnerOf?.(pay.feedId),
    );
    const weights = rows.map((r) => ({ fid: r.creatorFid, w: r.views + 3 * r.likes + 5 * r.replies }));
    const sum = weights.reduce((a, b) => a + b.w, 0);
    if (sum === 0) continue; // unallocated -> rolls over onchain
    const SCALE = 1_000_000n;
    for (const { fid, w } of weights) {
      const share = (pay.toCreators * BigInt(Math.floor((w / sum) * 1_000_000))) / SCALE;
      if (share === 0n) continue;
      const k = `${fid}|${pay.token}`;
      totals.set(k, (totals.get(k) ?? 0n) + share);
    }
  }

  return [...totals.entries()].map(([k, amount]) => {
    const [fid, token] = k.split("|");
    return { fid: Number(fid), token: token!, amount };
  });
}
