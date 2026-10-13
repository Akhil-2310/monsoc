"use client";
import { bytesToHex, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { HDKey } from "@scure/bip32";
import { entropyToMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { createPasskeyWithPrfOutput, getPasskeyPrfOutput, createSecp256k1SigningSession } from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";
import type { CustodySigner } from "@monsoc/sdk";
import cfg from "@/monsoc.config";

/**
 * Where the user's identity lives. The protocol only needs an address that can sign EIP-712
 * (an EOA, or an ERC-1271 smart account), so any passkey wallet plugs in here.
 */
export interface Connected {
  custody: CustodySigner;
  /** Private key of a deterministic app key from the same secret, so any device with the passkey restores it. */
  appKey?: Hex;
  /** Wipe key material held in memory once signup/login is done. */
  end(): void;
}

export interface CustodyProvider {
  id: string;
  label: string;
  /** First visit: create the credential. `name` is shown in the user's passkey manager. */
  create(name: string): Promise<Connected>;
  /** Later visits, on any device the passkey has synced to. */
  connect(): Promise<Connected>;
}

// ------------------------------------------------------------------ Mera (passkey, default)

const CRED_KEY = "monsoc.passkeyCredential";
const CUSTODY_PATH = "m/44'/60'/0'/0/0";
const APP_KEY_PATH = "m/44'/60'/0'/0/1";

function accountsFromPrf(prfOutput: Uint8Array): Connected {
  const seed = mnemonicToSeedSync(entropyToMnemonic(prfOutput, wordlist));
  const root = HDKey.fromMasterSeed(seed);
  const custodyNode = root.derive(CUSTODY_PATH);
  const appNode = root.derive(APP_KEY_PATH);
  if (!custodyNode.privateKey || !appNode.privateKey) throw new Error("passkey derivation produced no key");

  // The custody key lives only inside a Mera signing session and is never stored.
  const session = createSecp256k1SigningSession({ privateKey: custodyNode.privateKey });
  custodyNode.wipePrivateData();
  const custody = toViemAccount(session);

  // The app key is a scoped, revocable key the client keeps between visits (see session.tsx).
  const appKey = bytesToHex(appNode.privateKey);
  appNode.wipePrivateData();
  return { custody: { address: custody.address, signTypedData: custody.signTypedData }, appKey, end: () => session.end() };
}

/**
 * Mera: a passkey creates 32 secret bytes through the WebAuthn PRF extension and both keys are
 * derived from them. No seed phrase, no custody backend, no smart-account contracts.
 * Needs HTTPS (or localhost) and an authenticator with PRF: iCloud Keychain, 1Password, Google
 * Password Manager.
 */
export const meraProvider: CustodyProvider = {
  id: "mera",
  label: "Passkey",
  async create(name) {
    const res = await createPasskeyWithPrfOutput({
      rp: { id: location.hostname, name: cfg.name },
      user: { name, displayName: `@${name} on ${cfg.name}` },
    });
    const { prfOutput, prfSalt, ...credential } = res;
    void prfSalt; // mera uses a stable default salt, so sign-in reproduces the same bytes
    localStorage.setItem(CRED_KEY, JSON.stringify(credential));
    return accountsFromPrf(prfOutput);
  },
  async connect() {
    const saved = localStorage.getItem(CRED_KEY);
    // Without a pinned credential the browser offers any passkey it holds for this site.
    const { prfOutput } = await getPasskeyPrfOutput({
      rpId: location.hostname,
      credential: saved ? JSON.parse(saved) : undefined,
    });
    return accountsFromPrf(prfOutput);
  },
};

// ------------------------------------------------------------------ device key (dev fallback)

const BURNER_KEY = "monsoc.custody";

function deviceAccount(): Connected {
  let k = localStorage.getItem(BURNER_KEY) as `0x${string}` | null;
  if (!k) {
    k = generatePrivateKey();
    localStorage.setItem(BURNER_KEY, k);
  }
  const acct = privateKeyToAccount(k);
  return { custody: { address: acct.address, signTypedData: acct.signTypedData }, end: () => undefined };
}

/** Fallback for passkey managers without PRF: a key kept in this browser (not restorable elsewhere). */
export const deviceProvider: CustodyProvider = {
  id: "device",
  label: "this browser's key",
  create: async () => deviceAccount(),
  connect: async () => deviceAccount(),
};

export const providers: CustodyProvider[] = cfg.devKeyLogin ? [meraProvider, deviceProvider] : [meraProvider];

export function isPrfUnsupported(e: unknown): boolean {
  return (e as { code?: string })?.code === "PRF_UNAVAILABLE";
}
