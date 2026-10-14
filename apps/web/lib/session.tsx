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
  identityAbi,
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
import { meraProvider, deviceProvider, type CustodyProvider } from "./custody";

export const relay = new RelayClient(cfg.relayUrl);
export const deployment: Deployment = getDeployment(cfg.chainId);
export const publicClient = createPublicClient({ chain: getChain(cfg.chainId), transport: http(cfg.rpcUrl) });

/** Estimate gas, retrying a revert a few times: right after a previous tx (e.g. an approve) the
 *  load-balanced RPC can briefly answer from a node that hasn't applied it yet. */
async function estimateGas(account: Address, to: Address, data: Hex): Promise<bigint> {
  for (let i = 0; ; i++) {
    try {
      return await publicClient.estimateGas({ account, to, data });
    } catch (e) {
      if (i >= 4) throw e;
      await new Promise((r) => setTimeout(r, 700 * (i + 1)));
    }
  }
}

const K = {
  appKey: "monsoc.appKey",
  fid: "monsoc.fid",
  custody: "monsoc.custodyAddr",
  provider: "monsoc.provider",
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
  /** Owner-only: re-derives the custody key (passkey prompt) and changes the onchain handle. */
  changeHandle(handle: string): Promise<void>;
  addBackupPasskey(): Promise<void>;
  recoverWithBackup(): Promise<string | null>;
  send<T extends MessageType>(type: T, body: BodyFor<T>): Promise<SignedMessage<T>>;
  call(to: Address, abi: Abi | readonly unknown[], functionName: string, args: readonly unknown[]): Promise<Hex>;
  setFollow(target: number, on: boolean): Promise<void>;
  /** accounts you've muted / blocked (signed, so every client respects them) */
  muted: Set<number>;
  blocked: Set<number>;
  setRelation(kind: "mute" | "block", target: number, on: boolean): Promise<void>;
  refresh(): Promise<void>;
}

const Ctx = createContext<Session | null>(null);

/** Sign a forward request with `signer` (an app key or the custody itself) and have the relay submit it. */
async function forwardSigned(
  signer: Pick<LocalAccount, "address" | "signTypedData">,
  to: Address,
  abi: Abi | readonly unknown[],
  functionName: string,
  args: readonly unknown[],
) {
  const data = encodeFunctionData({ abi: abi as Abi, functionName, args } as never);
  const [nonce, est] = await Promise.all([relay.forwarderNonce(signer.address), estimateGas(signer.address, to, data)]);
  const req = await signForwardRequest(signer, { chainId: cfg.chainId, forwarder: deployment.forwarder, to, data, nonce, gas: (est * 12n) / 10n + 30_000n });
  const r = await relay.forward(req);
  if (r.status !== "success") throw new Error(`${functionName} reverted`);
}

/** A brand-new account reaches the relay's index ~1-2s after its tx, so retry briefly instead of showing no profile. */
async function userWhenIndexed(fid: number, tries = 15): Promise<Profile | null> {
  for (let i = 0; i < tries; i++) {
    const p = await relay.user(fid).catch(() => null);
    if (p) return p;
    await new Promise((r) => setTimeout(r, 800));
  }
  return null;
}

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
  const [muted, setMuted] = useState<Set<number>>(new Set());
  const [blocked, setBlocked] = useState<Set<number>>(new Set());
  const seqRef = useRef(0);
  const sendQueue = useRef<Promise<unknown>>(Promise.resolve());

  const loadUser = useCallback(async (f: number) => {
    const [p, fol, rel] = await Promise.all([
      userWhenIndexed(f),
      relay.following(f).catch(() => []),
      relay.relations(f).catch(() => ({ muted: [], blocked: [] })),
    ]);
    setProfile(p);
    setFollowing(new Set(fol.map((x) => x.fid)));
    setMuted(new Set(rel.muted.map((x) => x.fid)));
    setBlocked(new Set(rel.blocked.map((x) => x.fid)));
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
    async (f: number, key: Hex, c: Address, providerId: string) => {
      localStorage.setItem(K.provider, providerId);
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
          await adopt(existing.fid, await chooseKey(signer, existing.fid, conn.appKey), signer.address, provider.id);
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
        await adopt(f, key, signer.address, provider.id);
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
        await adopt(existing.fid, await chooseKey(conn.custody, existing.fid, conn.appKey), conn.custody.address, provider.id);
        return true;
      } finally {
        conn.end();
      }
    },
    [adopt, chooseKey],
  );

  const logout = useCallback(() => {
    for (const k of [K.appKey, K.fid, K.custody, K.provider]) localStorage.removeItem(k);
    setFid(null);
    setProfile(null);
    setAppKey(null);
    setCustody(null);
    setFollowing(new Set());
    setMuted(new Set());
    setBlocked(new Set());
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
        // Monad charges for the gas limit, not gas used, so sign a tight limit instead of a generous default.
        // Our contracts read _msgSender() == app key either way, so estimating the call directly is exact.
        const [nonce, est] = await Promise.all([
          relay.forwarderNonce(appKey.address),
          estimateGas(appKey.address, to, data),
        ]);
        const gas = (est * 12n) / 10n + 30_000n;
        const req = await signForwardRequest(appKey, { chainId: cfg.chainId, forwarder: deployment.forwarder, to, data, nonce, gas });
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

  /** Which key owns this account: the passkey (Mera), unless this session used the browser key. */
  const custodyProvider = useCallback((): CustodyProvider => {
    const stored = localStorage.getItem(K.provider);
    const browserKey = localStorage.getItem("monsoc.custody") as Hex | null;
    const browserOwns = !!browserKey && !!custody && privateKeyToAccount(browserKey).address.toLowerCase() === custody.toLowerCase();
    return stored === deviceProvider.id || (!stored && browserOwns) ? deviceProvider : meraProvider;
  }, [custody]);

  /** Owner-only call: re-derive the custody key (passkey prompt), sign it, and let the relay submit it. */
  const asCustody = useCallback(
    async (functionName: string, args: readonly unknown[]) => {
      if (!custody) throw new Error("sign in first");
      const conn = await custodyProvider().connect();
      try {
        if (conn.custody.address.toLowerCase() !== custody.toLowerCase())
          throw new Error("That passkey belongs to a different account. Pick the passkey you signed up with.");
        await forwardSigned(conn.custody, deployment.identity, identityAbi, functionName, args);
      } finally {
        conn.end();
      }
    },
    [custody, custodyProvider],
  );

  const waitForProfile = useCallback(async (f: number, done: (p: Profile) => boolean) => {
    for (let i = 0; i < 20; i++) {
      const p = await relay.user(f).catch(() => null);
      if (p && done(p)) return setProfile(p);
      await new Promise((r) => setTimeout(r, 750));
    }
  }, []);

  const changeHandle = useCallback(
    async (handle: string) => {
      if (!fid || !custody) throw new Error("sign in first");
      const next = handle.toLowerCase().replace(/^@/, "");
      const ok = await publicClient.readContract({ address: deployment.identity, abi: identityAbi, functionName: "isValidHandle", args: [next] });
      if (!ok) throw new Error("Handle must be 1-16 characters: a-z, 0-9, _");
      const taken = await publicClient.readContract({ address: deployment.identity, abi: identityAbi, functionName: "fidByHandle", args: [next] });
      if (taken !== 0n) throw new Error(taken === BigInt(fid) ? "That's already your handle" : `@${next} is taken`);
      await asCustody("setHandle", [next]);
      await waitForProfile(fid, (p) => p.handle === next);
    },
    [fid, custody, asCustody, waitForProfile],
  );

  /**
   * Create a second passkey (ideally in another password manager or on another device) and set its address
   * as this account's recovery address. Two prompts: the new backup passkey, then your current one to approve.
   */
  const addBackupPasskey = useCallback(async () => {
    if (!fid || !custody) throw new Error("sign in first");
    const backup = await meraProvider.create(`${profile?.handle ?? fid} (backup)`, { pin: false });
    const backupAddress = backup.custody.address;
    backup.end();
    if (backupAddress.toLowerCase() === custody.toLowerCase()) throw new Error("That's your main passkey; pick a different one for the backup");
    await asCustody("setRecovery", [backupAddress]);
    await waitForProfile(fid, (p) => p.recovery?.toLowerCase() === backupAddress.toLowerCase());
  }, [fid, custody, profile?.handle, asCustody, waitForProfile]);

  /** Lost your main passkey? Use the backup: it becomes the account's new owner, and you're signed in. */
  const recoverWithBackup = useCallback(async () => {
    const conn = await meraProvider.connect({ any: true });
    try {
      const addr = conn.custody.address;
      const accounts = await relay.recoverableBy(addr);
      if (accounts.length === 0) throw new Error("This passkey isn't a backup for any account.");
      const f = accounts[0]!.fid;
      await forwardSigned(conn.custody, deployment.identity, identityAbi, "recover", [BigInt(f), addr]);
      // wait until the relay sees the new owner, then sign in with it
      for (let i = 0; i < 20 && !(await relay.userByCustody(addr).catch(() => null)); i++) await new Promise((r) => setTimeout(r, 750));
      await adopt(f, await chooseKey(conn.custody, f, conn.appKey), addr, meraProvider.id);
      return accounts[0]!.handle;
    } finally {
      conn.end();
    }
  }, [adopt, chooseKey]);

  const setRelation = useCallback(
    async (kind: "mute" | "block", target: number, on: boolean) => {
      const set = kind === "mute" ? setMuted : setBlocked;
      const flip = (v: boolean) =>
        set((cur) => {
          const n = new Set(cur);
          v ? n.add(target) : n.delete(target);
          return n;
        });
      flip(on);
      try {
        await send(kind, on ? { targetFid: target } : { targetFid: target, undo: true });
      } catch (e) {
        flip(!on);
        throw e;
      }
    },
    [send],
  );

  const refresh = useCallback(async () => {
    if (fid) await loadUser(fid);
  }, [fid, loadUser]);

  const value = useMemo<Session>(
    () => ({ ready, fid, profile, custody, appKey, following, signup, login, logout, changeHandle, addBackupPasskey, recoverWithBackup, send, call, setFollow, muted, blocked, setRelation, refresh }),
    [ready, fid, profile, custody, appKey, following, signup, login, logout, changeHandle, addBackupPasskey, recoverWithBackup, send, call, setFollow, muted, blocked, setRelation, refresh],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
