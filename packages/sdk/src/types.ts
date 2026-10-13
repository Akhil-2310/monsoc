import type { Address, Hex } from "viem";

export interface Deployment {
  chainId: number;
  startBlock: number;
  forwarder: Address;
  identity: Address;
  appKeys: Address;
  signup: Address;
  follows: Address;
  feeds: Address;
  payments: Address;
  anchor: Address;
  communities: Address;
  scouts: Address;
  oracle: Address;
  tusd: Address;
}

// ------------------------------------------------------------------ protocol messages

export type MessageType =
  | "post"
  | "reply"
  | "like"
  | "repost"
  | "delete"
  | "trial-post"
  | "trial-release"
  | "back"
  | "view"
  | "chat"
  | "label"
  | "profile";

export interface MediaItem {
  uri: string;
  kind: "image" | "video";
  sha256?: Hex;
  mime?: string;
  width?: number;
  height?: number;
  durationMs?: number;
}

export interface PostBody {
  text: string;
  tags?: string[];
  links?: string[];
  /** https:// (e.g. ImageKit) or ipfs:// links; sha256 of the file lets any client detect a swapped file */
  media?: MediaItem[];
  community?: number;
  lang?: string;
}

export interface ReplyBody extends PostBody {
  parent: Hex;
}

export interface TrialBody extends PostBody {
  trial: {
    /** topic tags whose feeds may show this trial in discovery slots */
    topics: string[];
    /** shared id for A/B variants of the same trial */
    groupId?: string;
    variant?: "A" | "B";
    /** auto-release to followers if it beats the creator's average engagement rate within the window */
    autoRelease?: { windowHours: number; beatAverage: true };
  };
}

export interface TargetBody {
  target: Hex;
}

export interface BackBody {
  /** creator being backed */
  targetFid: number;
  /** post (often a trial) where the scout discovered them */
  target?: Hex;
}

export interface ViewBody {
  target: Hex;
  /** feed the post was surfaced in; drives subscription payouts */
  feedId: number;
  dwellMs?: number;
  completion?: number; // 0..1 for video
}

export interface ChatBody {
  community: number;
  room: string;
  text: string;
}

export interface LabelBody {
  target: Hex;
  labels: string[];
  /** true removes previously applied labels */
  neg?: boolean;
}

/** Profile details. Each message replaces the previous one in full; the newest timestamp wins. */
export interface ProfileBody {
  displayName?: string; // <= 50 chars
  bio?: string; // <= 280 chars
  avatar?: string; // ipfs:// or https:// image
  banner?: string; // ipfs:// or https:// image
  url?: string; // https:// link
  location?: string; // <= 50 chars
}

export const PROFILE_LIMITS = { displayName: 50, bio: 280, location: 50, url: 200, image: 300 } as const;

export type BodyFor<T extends MessageType> = T extends "post"
  ? PostBody
  : T extends "reply"
    ? ReplyBody
    : T extends "trial-post"
      ? TrialBody
      : T extends "like" | "repost" | "delete" | "trial-release"
        ? TargetBody
        : T extends "back"
          ? BackBody
          : T extends "view"
            ? ViewBody
            : T extends "chat"
              ? ChatBody
              : T extends "label"
                ? LabelBody
                : T extends "profile"
                  ? ProfileBody
                  : never;

export interface MessageData<T extends MessageType = MessageType> {
  type: T;
  fid: number;
  /** ms since epoch */
  timestamp: number;
  /** per-fid counter so relays can detect gaps */
  seq: number;
  body: BodyFor<T>;
}

export interface SignedMessage<T extends MessageType = MessageType> {
  data: MessageData<T>;
  /** permanent id: keccak256 of the canonical encoding */
  hash: Hex;
  /** app key address that signed */
  signer: Address;
  signature: Hex;
}

// ------------------------------------------------------------------ read API shapes

export interface Profile {
  fid: number;
  custody: Address;
  handle: string | null;
  followers: number;
  following: number;
  verifiedFollowers: number;
  reputation: number;
  scoutScore: number;
  scoutTier: string | null;
  createdAt: number;
  displayName: string | null;
  bio: string | null;
  avatar: string | null;
  banner: string | null;
  url: string | null;
  location: string | null;
}

export interface PostView {
  hash: Hex;
  fid: number;
  handle: string | null;
  displayName: string | null;
  avatar: string | null;
  type: "post" | "reply" | "trial-post";
  timestamp: number;
  text: string;
  tags: string[];
  links: string[];
  media: PostBody["media"];
  community: number | null;
  parent: Hex | null;
  labels: string[];
  trial: (TrialBody["trial"] & { status: "testing" | "released" | "dropped" }) | null;
  stats: { likes: number; replies: number; reposts: number; backs: number; views: number; depth: number };
  authorFollowers: number;
  authorReputation: number;
  anchored: boolean;
}
