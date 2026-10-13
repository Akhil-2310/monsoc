import type { Address, Hex, LocalAccount, TypedDataDomain } from "viem";

/**
 * Sponsored transactions. The app key signs an ERC-2771 ForwardRequest; the relay submits it to the
 * forwarder and pays gas. Contracts see the app key as the sender and check its scope for the fid.
 */
export const forwardRequestTypes = {
  ForwardRequest: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "gas", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint48" },
    { name: "data", type: "bytes" },
  ],
} as const;

export interface ForwardRequestData {
  from: Address;
  to: Address;
  value: bigint;
  gas: bigint;
  deadline: number;
  data: Hex;
  signature: Hex;
}

export function forwarderDomain(chainId: number, forwarder: Address): TypedDataDomain {
  return { name: "MonSocForwarder", version: "1", chainId, verifyingContract: forwarder };
}

export async function signForwardRequest(
  account: LocalAccount,
  args: {
    chainId: number;
    forwarder: Address;
    to: Address;
    data: Hex;
    nonce: bigint;
    value?: bigint;
    gas?: bigint;
    ttlSeconds?: number;
  },
): Promise<ForwardRequestData> {
  const value = args.value ?? 0n;
  // relays pay for gas used, not the limit, so a generous default is free; long URIs need it
  const gas = args.gas ?? 3_000_000n;
  const deadline = Math.floor(Date.now() / 1000) + (args.ttlSeconds ?? 600);
  const signature = await account.signTypedData({
    domain: forwarderDomain(args.chainId, args.forwarder),
    types: forwardRequestTypes,
    primaryType: "ForwardRequest",
    message: { from: account.address, to: args.to, value, gas, nonce: args.nonce, deadline, data: args.data },
  });
  return { from: account.address, to: args.to, value, gas, deadline, data: args.data, signature };
}

// ------------------------------------------------------------------ signup

export const signupTypes = {
  Signup: [
    { name: "custody", type: "address" },
    { name: "recovery", type: "address" },
    { name: "handle", type: "string" },
    { name: "keyType", type: "uint8" },
    { name: "key", type: "bytes" },
    { name: "scope", type: "uint32" },
    { name: "expiry", type: "uint64" },
    { name: "clientFid", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export interface SignupParams {
  custody: Address;
  recovery: Address;
  handle: string;
  keyType: number;
  key: Hex;
  scope: number;
  expiry: bigint;
  clientFid: bigint;
  deadline: bigint;
}

export function signupDomain(chainId: number, signup: Address): TypedDataDomain {
  return { name: "MonSocSignup", version: "1", chainId, verifyingContract: signup };
}

/**
 * Anything that can sign EIP-712 for the custody address: a burner EOA in dev, or a passkey smart
 * account (ERC-1271) from your wallet provider in production.
 */
export interface CustodySigner {
  address: Address;
  signTypedData: LocalAccount["signTypedData"];
}

export function signupTypedData(chainId: number, signup: Address, p: SignupParams, nonce: bigint) {
  return {
    domain: signupDomain(chainId, signup),
    types: signupTypes,
    primaryType: "Signup" as const,
    message: { ...p, nonce },
  };
}

export const Scopes = {
  POST: 1,
  FOLLOW: 2,
  COMMUNITY: 4,
  FEED: 8,
  CHAT: 16,
  PAY: 32,
  ANCHOR: 64,
  FULL: 0xffffffff,
} as const;

export const KeyTypes = { SECP256K1: 1, ED25519: 2, P256: 3, X25519: 4 } as const;

// ------------------------------------------------------------------ add app key (new device)

export const addKeyTypes = {
  AddKey: [
    { name: "fid", type: "uint256" },
    { name: "keyType", type: "uint8" },
    { name: "key", type: "bytes" },
    { name: "scope", type: "uint32" },
    { name: "expiry", type: "uint64" },
    { name: "clientFid", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export function addKeyTypedData(
  chainId: number,
  appKeys: Address,
  m: { fid: bigint; keyType: number; key: Hex; scope: number; expiry: bigint; clientFid: bigint; nonce: bigint; deadline: bigint },
) {
  return {
    domain: { name: "MonSocAppKeys", version: "1", chainId, verifyingContract: appKeys } as TypedDataDomain,
    types: addKeyTypes,
    primaryType: "AddKey" as const,
    message: m,
  };
}
