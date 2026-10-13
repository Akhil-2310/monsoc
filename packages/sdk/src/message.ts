import { keccak256, recoverAddress, toBytes, type Hex, type LocalAccount } from "viem";
import type { MessageData, MessageType, SignedMessage, BodyFor } from "./types";

const DOMAIN = "monsoc:msg:v1:";

/** Deterministic JSON: sorted object keys, no whitespace, undefined dropped. */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
}

/** The message hash is its permanent id. Signer is bound in so a key can't be swapped. */
export function hashMessage(data: MessageData, signer: string): Hex {
  return keccak256(toBytes(DOMAIN + canonicalize({ ...data, signer: signer.toLowerCase() })));
}

export async function signMessage<T extends MessageType>(
  account: LocalAccount,
  data: MessageData<T>,
): Promise<SignedMessage<T>> {
  if (!account.sign) throw new Error("app key account must support raw hash signing");
  const hash = hashMessage(data, account.address);
  const signature = await account.sign({ hash });
  return { data, hash, signer: account.address, signature };
}

/** Checks hash + signature only. Relays additionally check the signer is an active app key for data.fid. */
export async function verifyMessage(msg: SignedMessage): Promise<boolean> {
  const hash = hashMessage(msg.data, msg.signer);
  if (hash !== msg.hash) return false;
  try {
    const recovered = await recoverAddress({ hash, signature: msg.signature });
    return recovered.toLowerCase() === msg.signer.toLowerCase();
  } catch {
    return false;
  }
}

/** Helper that keeps a per-fid sequence counter (persist `seq` between sessions). */
export class MessageBuilder {
  constructor(
    private account: LocalAccount,
    public fid: number,
    public seq = 0,
  ) {}

  async build<T extends MessageType>(type: T, body: BodyFor<T>, timestamp = Date.now()): Promise<SignedMessage<T>> {
    this.seq += 1;
    return signMessage(this.account, { type, fid: this.fid, timestamp, seq: this.seq, body });
  }
}

/** Rough text-only tag extraction (#ai #cricket). Clients may also attach tags explicitly. */
export function extractTags(text: string): string[] {
  const tags = new Set<string>();
  for (const m of text.matchAll(/(^|\s)#([a-z0-9_]{1,32})/gi)) tags.add(m[2]!.toLowerCase());
  return [...tags];
}

export function extractLinks(text: string): string[] {
  return [...text.matchAll(/https?:\/\/[^\s)]+/g)].map((m) => m[0]);
}
