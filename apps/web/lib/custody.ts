"use client";
import { keccak256, toBytes, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { CustodySigner } from "@monsoc/sdk";

/**
 * Where the user's identity lives. The protocol only needs an address that can sign EIP-712
 * (EOA, or an ERC-1271 smart account), so any passkey wallet plugs in here.
 *
 * To add a passkey provider (Privy, Mera, ...): implement `connect()` to log the user in and return
 * the embedded/smart wallet's address and a `signTypedData` that routes to it. Nothing else changes.
 */
export interface CustodyProvider {
  id: string;
  label: string;
  connect(): Promise<CustodySigner>;
}

const BURNER_KEY = "monsoc.custody";

function storedKey(name: string): Hex {
  let k = localStorage.getItem(name) as Hex | null;
  if (!k) {
    k = generatePrivateKey();
    localStorage.setItem(name, k);
  }
  return k;
}

/** Dev/testnet: a key generated and kept in this browser. Swap for a passkey provider in production. */
export const burnerProvider: CustodyProvider = {
  id: "burner",
  label: "Device key (dev)",
  async connect() {
    const acct = privateKeyToAccount(storedKey(BURNER_KEY));
    return { address: acct.address, signTypedData: acct.signTypedData };
  },
};

/** Seeded demo accounts derive keys from the handle (matches apps/relay/src/seed.ts). Dev chains only. */
export const demoKey = (handle: string, kind: "custody" | "app") => keccak256(toBytes(`monsoc-demo:${kind}:${handle}`));

export function demoCustody(handle: string): CustodySigner {
  const acct = privateKeyToAccount(demoKey(handle, "custody"));
  return { address: acct.address, signTypedData: acct.signTypedData };
}

export const providers: CustodyProvider[] = [burnerProvider];
