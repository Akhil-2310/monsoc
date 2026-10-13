import type { Address, Hex } from "viem";
import type { ForwardRequestData, SignupParams } from "./meta";
import type { Notification, PostView, Profile, SignedMessage } from "./types";
import type { FeedDefinition } from "./feed";

export interface FeedInfo {
  id: number;
  ownerFid: number;
  ownerHandle: string | null;
  kind: "rule" | "hosted";
  name: string;
  description: string;
  uri: string;
  defHash: Hex;
  version: number;
  priceUsd: number; // 6 decimals
  creatorShareBps: number;
  discoveryBps: number;
  active: boolean;
  definition: FeedDefinition | null;
  endpoint: string | null;
  subscribers: number;
}

export interface CommunityInfo {
  id: number;
  ownerFid: number;
  name: string;
  description: string;
  rules: string[];
  joinType: "open" | "token" | "invite" | "paid";
  gateToken: Address | null;
  gateMin: string;
  priceUsd: number;
  period: number;
  feedId: number;
  memberCount: number;
  rooms: string[];
  tags: string[];
}

export interface TrialResults {
  hash: Hex;
  status: "testing" | "released" | "dropped";
  variants: {
    hash: Hex;
    variant: "A" | "B" | null;
    reach: number;
    views: number;
    avgDwellMs: number;
    completion: number;
    likes: number;
    replies: number;
    backs: number;
    followsGained: number;
    engagementRate: number;
  }[];
  creatorAverageRate: number;
  autoRelease: { windowHours: number; endsAt: number } | null;
}

export interface MarketInfo {
  id: number;
  creator: { fid: number; handle: string | null; displayName: string | null; avatar: string | null; followers: number } | null;
  openerFid: number;
  openerHandle: string | null;
  target: number;
  openedAt: number;
  deadline: number;
  maxFid: number;
  counted: number;
  outcome: "open" | "yes" | "no" | "void";
  resolvedAt: number | null;
  yesPool: string;
  noPool: string;
  yesWeight: string;
  noWeight: string;
  yesShare: number;
  creatorFee: string;
  stakers: number;
}

export interface MarketDetail extends MarketInfo {
  stakes: { fid: number; handle: string | null; yes: boolean; amount: string; weight: string; at: number }[];
  position: { yesStake: string; noStake: string; yesWeight: string; noWeight: string; claimed: boolean; payout: string } | null;
  /** share weight a stake placed now would get (2.0 at open → 1.0 at deadline) */
  multiplier: number;
}

export interface FeedInputs {
  following: number[];
  posts: PostView[];
}

/** Thin client for the relay + indexer read API. Every client built on the protocol uses this. */
export class RelayClient {
  constructor(public baseUrl: string) {}

  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(this.baseUrl + path, {
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
      body: init?.body,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error(json?.error ?? `${res.status} ${res.statusText}`);
    return json as T;
  }

  private post<T>(path: string, body: unknown) {
    return this.req<T>(path, { method: "POST", body: JSON.stringify(body, replaceBigInt) });
  }

  // writes
  submit(msg: SignedMessage) {
    return this.post<{ hash: Hex; relaySeq: number }>("/v1/messages", msg);
  }
  signup(params: SignupParams, signature: Hex) {
    return this.post<{ fid: number; txHash: Hex }>("/v1/sponsor/signup", { params, signature });
  }
  forward(request: ForwardRequestData) {
    return this.post<{ txHash: Hex; status: "success" | "reverted" }>("/v1/sponsor/forward", { request });
  }
  forwarderNonce(address: Address) {
    return this.req<{ nonce: string }>(`/v1/sponsor/nonce/${address}`).then((r) => BigInt(r.nonce));
  }
  signupNonce(address: Address) {
    return this.req<{ nonce: string }>(`/v1/sponsor/signup-nonce/${address}`).then((r) => BigInt(r.nonce));
  }
  addKey(p: { fid: number; keyType: number; key: Hex; scope: number; expiry: bigint; clientFid: bigint; deadline: bigint; signature: Hex }) {
    return this.post<{ txHash: Hex }>("/v1/sponsor/add-key", p);
  }
  keyNonce(custody: Address) {
    return this.req<{ nonce: string }>(`/v1/sponsor/key-nonce/${custody}`).then((r) => BigInt(r.nonce));
  }
  mediaConfig() {
    return this.req<{ enabled: boolean; provider: string | null }>("/v1/media/config");
  }
  mediaAuth(p: { fid: number; ts: number; signer: Address; signature: Hex }) {
    return this.post<{ token: string; expire: number; signature: string; publicKey: string; urlEndpoint: string; folder: string }>(
      "/v1/media/auth",
      p,
    );
  }
  markets(opts: { status?: "open" | "resolved"; creator?: number; fid?: number } = {}) {
    const q = new URLSearchParams();
    if (opts.status) q.set("status", opts.status);
    if (opts.creator) q.set("creator", String(opts.creator));
    if (opts.fid) q.set("fid", String(opts.fid));
    return this.req<MarketInfo[]>(`/v1/markets?${q}`);
  }
  market(id: number, viewer?: number) {
    return this.req<MarketDetail>(`/v1/markets/${id}${viewer ? `?viewer=${viewer}` : ""}`);
  }
  marketInfo(fid: number) {
    return this.req<{ enabled: boolean; optedIn: boolean; creatorFees: string }>(`/v1/users/${fid}/market-info`);
  }
  faucet(address: Address) {
    return this.post<{ txHash: Hex }>("/v1/faucet", { address });
  }

  // reads
  info() {
    return this.req<{ chainId: number; deployment: Record<string, Address>; relay: Address; epoch: number }>("/v1/info");
  }
  user(fidOrHandle: number | string) {
    return this.req<Profile>(`/v1/users/${fidOrHandle}`);
  }
  userByCustody(address: Address) {
    return this.req<Profile | null>(`/v1/custody/${address}`);
  }
  followers(fid: number) {
    return this.req<Profile[]>(`/v1/users/${fid}/followers`);
  }
  following(fid: number) {
    return this.req<Profile[]>(`/v1/users/${fid}/following`);
  }
  userPosts(fid: number, viewer?: number) {
    return this.req<PostView[]>(`/v1/users/${fid}/posts${viewer ? `?viewer=${viewer}` : ""}`);
  }
  feedInputs(fid: number, opts: { topics?: string[]; community?: number; limit?: number } = {}) {
    const q = new URLSearchParams({ fid: String(fid) });
    if (opts.topics?.length) q.set("topics", opts.topics.join(","));
    if (opts.community) q.set("community", String(opts.community));
    if (opts.limit) q.set("limit", String(opts.limit));
    return this.req<FeedInputs>(`/v1/feed-inputs?${q}`);
  }
  posts(hashes: Hex[], viewer?: number) {
    return this.post<PostView[]>("/v1/posts/batch", { hashes, viewer });
  }
  thread(hash: Hex, viewer?: number) {
    return this.req<{ root: PostView; replies: PostView[] }>(`/v1/threads/${hash}${viewer ? `?viewer=${viewer}` : ""}`);
  }
  notifications(fid: number, before?: number) {
    return this.req<Notification[]>(`/v1/users/${fid}/notifications${before ? `?before=${before}` : ""}`);
  }
  unreadCount(fid: number, since: number) {
    return this.req<{ count: number }>(`/v1/users/${fid}/notifications/count?since=${since}`);
  }
  relations(fid: number) {
    return this.req<{ muted: Profile[]; blocked: Profile[] }>(`/v1/users/${fid}/relations`);
  }
  search(q: string, viewer?: number) {
    const params = new URLSearchParams({ q });
    if (viewer) params.set("viewer", String(viewer));
    return this.req<{ users: Profile[]; posts: PostView[]; communities: CommunityInfo[]; feeds: FeedInfo[]; tags: { tag: string; posts: number }[] }>(
      `/v1/search?${params}`,
    );
  }
  proof(hash: Hex) {
    return this.req<{ batchId: number; root: Hex; proof: Hex[]; txHash: Hex } | { pending: true }>(`/v1/proofs/${hash}`);
  }
  feeds() {
    return this.req<FeedInfo[]>("/v1/feeds");
  }
  feed(id: number) {
    return this.req<FeedInfo & { versions: { version: number; uri: string; defHash: Hex; at: number }[] }>(`/v1/feeds/${id}`);
  }
  hostedFeed(endpoint: string, fid: number) {
    return fetch(`${endpoint}${endpoint.includes("?") ? "&" : "?"}fid=${fid}`).then(
      (r) => r.json() as Promise<{ items: { hash: Hex; reason?: string }[] }>,
    );
  }
  subscriptions(fid: number) {
    return this.req<{ feedId: number; until: number }[]>(`/v1/users/${fid}/subscriptions`);
  }
  communities() {
    return this.req<CommunityInfo[]>("/v1/communities");
  }
  community(id: number) {
    return this.req<CommunityInfo & { members: (Profile & { role: number })[] }>(`/v1/communities/${id}`);
  }
  memberships(fid: number) {
    return this.req<{ communityId: number; role: number }[]>(`/v1/users/${fid}/communities`);
  }
  chat(community: number, room: string, since = 0) {
    return this.req<SignedMessage<"chat">[]>(`/v1/chat/${community}/${room}?since=${since}`);
  }
  trialResults(hash: Hex) {
    return this.req<TrialResults>(`/v1/trials/${hash}`);
  }
  myTrials(fid: number) {
    return this.req<TrialResults[]>(`/v1/users/${fid}/trials`);
  }
  scouts(topic?: string) {
    return this.req<
      (Profile & { score: number; hits: number; backed: number; topFinds: { creator: number; handle: string | null; from: number; now: number }[] })[]
    >(`/v1/scouts${topic ? `?topic=${topic}` : ""}`);
  }
  backs(fid: number) {
    return this.req<{ creator: number; handle: string | null; at: number; from: number; now: number }[]>(`/v1/users/${fid}/backs`);
  }
  onboarding(address: Address) {
    return this.req<{
      communities: (CommunityInfo & { reason: string })[];
      people: (Profile & { reason: string })[];
      starterPacks: { id: string; name: string; fids: number[] }[];
    }>(`/v1/onboarding/${address}`);
  }
  balances(fid: number) {
    return this.req<{ token: Address; symbol: string; claimable: string }[]>(`/v1/users/${fid}/balances`);
  }
  payoutClaims(fid: number) {
    return this.req<{ epoch: number; token: Address; amount: string; proof: Hex[]; claimed: boolean }[]>(
      `/v1/users/${fid}/payouts`,
    );
  }
  labels() {
    return this.req<{ fid: number; handle: string | null; name: string; description: string }[]>("/v1/labelers");
  }

  /** Server-sent events for new messages (posts + chat). */
  stream(onMessage: (m: SignedMessage) => void): () => void {
    const es = new EventSource(`${this.baseUrl}/v1/stream`);
    es.onmessage = (e) => onMessage(JSON.parse(e.data));
    return () => es.close();
  }
}

export function replaceBigInt(_k: string, v: unknown) {
  return typeof v === "bigint" ? v.toString() : v;
}
