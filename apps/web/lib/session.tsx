"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPublicClient, encodeFunctionData, http, type Abi, type Address, type Hex, type LocalAccount } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  RelayClient,
  getDeployment,
  getChain,
  signMessage,
  signForwardRequest,
  signupTypedData,
  addKeyTypedData,
  followsAbi,
  appKeysAbi,
  Scopes,
  KeyTypes,
  type BodyFor,
  type CustodySigner,
  type Deployment,
  type MessageType,
  type Profile,
  type SignedMessage,
} from "@monsoc/sdk";
import cfg from "@/monsoc.config";
import type { CustodyProvider } from "./custody";

export const relay = new RelayClient(cfg.relayUrl);
export const deployment: Deployment = getDeployment(cfg.chainId);
export const publicClient = createPublicClient({ chain: getChain(cfg.chainId), transport: http(cfg.rpcUrl) });

const K = {
  appKey: "monsoc.appKey",
  fid: "monsoc.fid",
  custody: "monsoc.custodyAddr",
  seq: (fid: number) => `monsoc.seq.${fid}`,
};

interface Session {
  ready: boolean;
  fid: number | null;
  profile: Profile | null;
  custody: Address | null;
  appKey: LocalAccount | null;
  following: Set<number>;
  signup(provider: CustodyProvider, handle: string): Promise<void>;
  login(provider: CustodyProvider): Promise<boolean>;
  logout(): void;
  send<T extends MessageType>(type: T, body: BodyFor<T>): Promise<SignedMessage<T>>;
  call(to: Address, abi: Abi | readonly unknown[], functionName: string, args: readonly unknown[]): Promise<Hex>;
  setFollow(target: number, on: boolean): Promise<void>;
  refresh(): Promise<void>;
}

const Ctx = createContext<Session | null>(null);

export function useSession() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession outside SessionProvider");
  return s;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [fid, setFid] = useState<number | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [custody, setCustody] = useState<Address | null>(null);
  const [appKey, setAppKey] = useState<LocalAccount | null>(null);
  const [following, setFollowing] = useState<Set<number>>(new Set());
  const seqRef = useRef(0);
  const sendQueue = useRef<Promise<unknown>>(Promise.resolve());

  const loadUser = useCallback(async (f: number) => {
    const [p, fol] = await Promise.all([relay.user(f).catch(() => null), relay.following(f).catch(() => [])]);
    setProfile(p);
    setFollowing(new Set(fol.map((x) => x.fid)));
  }, []);

  // restore
  useEffect(() => {
    const k = localStorage.getItem(K.appKey) as Hex | null;
    const f = Number(localStorage.getItem(K.fid) ?? 0);
    if (k && f) {
      setAppKey(privateKeyToAccount(k));
      setFid(f);
      setCustody(localStorage.getItem(K.custody) as Address | null);
      seqRef.current = Number(localStorage.getItem(K.seq(f)) ?? Math.floor(Date.now() / 1000));
      loadUser(f).finally(() => setReady(true));
    } else setReady(true);
  }, [loadUser]);

  const adopt = useCallback(
    async (f: number, key: Hex, c: Address) => {
      localStorage.setItem(K.appKey, key);
      localStorage.setItem(K.fid, String(f));
      localStorage.setItem(K.custody, c);
      // seconds-based start avoids reusing sequence numbers from another device or session
      seqRef.current = Math.max(Number(localStorage.getItem(K.seq(f)) ?? 0), Math.floor(Date.now() / 1000));
      setAppKey(privateKeyToAccount(key));
      setFid(f);
      setCustody(c);
      await loadUser(f);
    },
    [loadUser],
  );

  /** Custody signs AddKey for a new app key on this device; the relay submits it gaslessly. */
  const authorizeNewKey = useCallback(async (signer: CustodySigner, f: number, preferred?: Hex): Promise<Hex> => {
    const key = preferred ?? generatePrivateKey();
    const acct = privateKeyToAccount(key);
    const nonce = await relay.keyNonce(signer.address);
    const m = {
      fid: BigInt(f),
      keyType: KeyTypes.SECP256K1,
      key: acct.address.toLowerCase() as Hex,
      scope: Scopes.FULL,
      expiry: 0n,
      clientFid: 0n,
      nonce,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
    };
    const signature = await signer.signTypedData(addKeyTypedData(cfg.chainId, deployment.appKeys, m) as never);
    await relay.addKey({ ...m, fid: f, signature });
    return key;
  }, []);

  /** Pick an app key for this fid: the one stored here, the passkey-derived one, or a fresh one. */
  const chooseKey = useCallback(
    async (signer: CustodySigner, f: number, derived?: Hex): Promise<Hex> => {
      const stored = localStorage.getItem(K.appKey) as Hex | null;
      if (stored && Number(localStorage.getItem(K.fid)) === f) return stored;
      if (derived) {
        const addr = privateKeyToAccount(derived).address;
        const k = await publicClient.readContract({
          address: deployment.appKeys,
          abi: appKeysAbi,
          functionName: "keyOf",
          args: [BigInt(f), addr.toLowerCase() as Hex],
        });
        if (k.addedAt === 0n) return authorizeNewKey(signer, f, derived);
        const active = !k.revoked && (k.expiry === 0n || k.expiry * 1000n > BigInt(Date.now()));
        if (active) return derived; // same passkey on a new device: nothing to sign
      }
      return authorizeNewKey(signer, f); // derived key was revoked: use a fresh one
    },
    [authorizeNewKey],
  );

  const signup = useCallback(
    async (provider: CustodyProvider, handle: string) => {
      const conn = await provider.create(handle.toLowerCase());
      try {
        const signer = conn.custody;
        const existing = await relay.userByCustody(signer.address);
        if (existing) {
          await adopt(existing.fid, await chooseKey(signer, existing.fid, conn.appKey), signer.address);
          return;
        }
        const key = conn.appKey ?? generatePrivateKey();
        const acct = privateKeyToAccount(key);
        const nonce = await relay.signupNonce(signer.address);
        const params = {
          custody: signer.address,
          recovery: signer.address,
          handle: handle.toLowerCase(),
          keyType: KeyTypes.SECP256K1,
          key: acct.address.toLowerCase() as Hex,
          scope: Scopes.FULL,
          expiry: 0n,
          clientFid: 0n,
          deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
        };
        const sig = await signer.signTypedData(signupTypedData(cfg.chainId, deployment.signup, params, nonce) as never);
        const { fid: f } = await relay.signup(params, sig);
        await adopt(f, key, signer.address);
      } finally {
        conn.end();
      }
    },
    [adopt, chooseKey],
  );

  const login = useCallback(
    async (provider: CustodyProvider) => {
      const conn = await provider.connect();
      try {
        const existing = await relay.userByCustody(conn.custody.address);
        if (!existing) return false;
        await adopt(existing.fid, await chooseKey(conn.custody, existing.fid, conn.appKey), conn.custody.address);
        return true;
      } finally {
        conn.end();
      }
    },
    [adopt, chooseKey],
  );

  const logout = useCallback(() => {
    for (const k of [K.appKey, K.fid, K.custody]) localStorage.removeItem(k);
    setFid(null);
    setProfile(null);
    setAppKey(null);
    setCustody(null);
    setFollowing(new Set());
  }, []);

  const send = useCallback(
    <T extends MessageType>(type: T, body: BodyFor<T>) => {
      if (!appKey || !fid) return Promise.reject(new Error("sign in first"));
      // serialize so sequence numbers go out in order
      const job = sendQueue.current.then(async () => {
        seqRef.current += 1;
        localStorage.setItem(K.seq(fid), String(seqRef.current));
        const m = await signMessage(appKey, { type, fid, timestamp: Date.now(), seq: seqRef.current, body });
        await relay.submit(m);
        return m;
      });
      sendQueue.current = job.catch(() => undefined);
      return job;
    },
    [appKey, fid],
  );

  const callQueue = useRef<Promise<unknown>>(Promise.resolve());
  const call = useCallback(
    (to: Address, abi: Abi | readonly unknown[], functionName: string, args: readonly unknown[]) => {
      if (!appKey) return Promise.reject(new Error("sign in first"));
      const job = callQueue.current.then(async () => {
        const data = encodeFunctionData({ abi: abi as Abi, functionName, args } as never);
        const nonce = await relay.forwarderNonce(appKey.address);
        const req = await signForwardRequest(appKey, { chainId: cfg.chainId, forwarder: deployment.forwarder, to, data, nonce });
        const r = await relay.forward(req);
        if (r.status !== "success") throw new Error(`${functionName} reverted`);
        return r.txHash;
      });
      callQueue.current = job.catch(() => undefined);
      return job;
    },
    [appKey],
  );

  /** Optimistic follow: the button flips now, the tx confirms in ~1s; revert on failure. */
  const setFollow = useCallback(
    async (target: number, on: boolean) => {
      if (!fid) throw new Error("sign in first");
      const flip = (v: boolean) =>
        setFollowing((s) => {
          const n = new Set(s);
          v ? n.add(target) : n.delete(target);
          return n;
        });
      flip(on);
      try {
        await call(deployment.follows, followsAbi, on ? "follow" : "unfollow", [BigInt(fid), BigInt(target)]);
      } catch (e) {
        flip(!on);
        throw e;
      }
    },
    [fid, call],
  );

  const refresh = useCallback(async () => {
    if (fid) await loadUser(fid);
  }, [fid, loadUser]);

  const value = useMemo<Session>(
    () => ({ ready, fid, profile, custody, appKey, following, signup, login, logout, send, call, setFollow, refresh }),
    [ready, fid, profile, custody, appKey, following, signup, login, logout, send, call, setFollow, refresh],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
