"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { erc20Abi, formatEther, type Address, type Hex } from "viem";
import { paymentsAbi, appKeysAbi, NATIVE } from "@monsoc/sdk";
import { Shell, PageHeader } from "@/components/Shell";
import { useSession, relay, publicClient, deployment } from "@/lib/session";
import { Avatar } from "@/components/Avatar";
import type { Profile } from "@monsoc/sdk";
import { errMsg, tokenAmount } from "@/lib/format";

type Claim = { epoch: number; token: Address; amount: string; proof: Hex[]; claimed: boolean };

export default function Wallet() {
  const { fid, custody, appKey, call, logout } = useSession();
  const [balances, setBalances] = useState<{ token: Address; symbol: string; claimable: string }[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [held, setHeld] = useState<{ custodyUsd: bigint; keyUsd: bigint; keyMon: bigint }>({ custodyUsd: 0n, keyUsd: 0n, keyMon: 0n });
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!fid || !custody || !appKey) return;
    const [b, c, custodyUsd, keyUsd, keyMon] = await Promise.all([
      relay.balances(fid),
      relay.payoutClaims(fid),
      publicClient.readContract({ address: deployment.tusd, abi: erc20Abi, functionName: "balanceOf", args: [custody] }),
      publicClient.readContract({ address: deployment.tusd, abi: erc20Abi, functionName: "balanceOf", args: [appKey.address] }),
      publicClient.getBalance({ address: appKey.address }),
    ]);
    setBalances(b);
    setClaims(c);
    setHeld({ custodyUsd, keyUsd, keyMon });
  }, [fid, custody, appKey]);
  useEffect(() => {
    load().catch((e) => setMsg(errMsg(e)));
  }, [load]);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setMsg(null);
    try {
      await fn();
      setMsg(`${label}: done`);
      setTimeout(load, 1200);
    } catch (e) {
      setMsg(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  if (!fid || !appKey || !custody)
    return <Shell><PageHeader title="Wallet" /><p className="p-6 text-sm text-muted"><Link href="/onboarding" className="text-accent">Sign in</Link> first.</p></Shell>;

  const dec = (t: Address) => (t === NATIVE ? 18 : 6);

  return (
    <Shell>
      <PageHeader title="Wallet & keys" sub="Prices in dollars, paid in MON or stablecoins. You claim what you earn." />
      <div className="space-y-4 p-4">
        <section className="card p-4">
          <h3 className="font-semibold">Earnings</h3>
          <p className="text-xs text-muted">Feed subscriptions, memberships and tips credited to your fid. Withdrawals always go to your custody address.</p>
          <div className="mt-3 space-y-2">
            {balances.map((b) => (
              <div key={b.token} className="flex items-center gap-3 rounded-xl bg-panel-2 px-3 py-2">
                <span className="flex-1 text-sm">{tokenAmount(b.claimable, dec(b.token))} {b.symbol}</span>
                <button
                  className="btn-ghost btn-sm"
                  disabled={b.claimable === "0" || !!busy}
                  onClick={() => run(`Withdraw ${b.symbol}`, () => call(deployment.payments, paymentsAbi, "withdraw", [BigInt(fid), b.token]))}
                >
                  Withdraw
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="card p-4">
          <h3 className="font-semibold">Creator payouts</h3>
          <p className="text-xs text-muted">
            Each epoch, subscribers' signed views decide how paid feeds share revenue with the creators they surfaced. One Merkle root per epoch; you
            claim with a proof.
          </p>
          {claims.length === 0 && <p className="mt-3 text-sm text-muted">Nothing yet. Get surfaced in a paid feed.</p>}
          <div className="mt-3 space-y-2">
            {claims.map((c) => (
              <div key={`${c.epoch}-${c.token}`} className="flex items-center gap-3 rounded-xl bg-panel-2 px-3 py-2 text-sm">
                <span className="flex-1">
                  Epoch {c.epoch}: {tokenAmount(c.amount, dec(c.token))} {c.token === NATIVE ? "MON" : "tUSD"}
                </span>
                {c.claimed ? (
                  <span className="chip bg-good/15 text-good">claimed</span>
                ) : (
                  <button
                    className="btn-primary btn-sm"
                    disabled={!!busy}
                    onClick={() =>
                      run(`Claim epoch ${c.epoch}`, () =>
                        call(deployment.payments, paymentsAbi, "claim", [BigInt(c.epoch), c.token, BigInt(fid), BigInt(c.amount), c.proof]),
                      )
                    }
                  >
                    Claim
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="card p-4">
          <h3 className="font-semibold">Testnet funds</h3>
          <div className="mt-2 grid gap-2 text-sm sm:grid-cols-3">
            <div className="rounded-xl bg-panel-2 px-3 py-2">Custody: {tokenAmount(held.custodyUsd, 6)} tUSD</div>
            <div className="rounded-xl bg-panel-2 px-3 py-2">App key: {tokenAmount(held.keyUsd, 6)} tUSD</div>
            <div className="rounded-xl bg-panel-2 px-3 py-2">App key: {Number(formatEther(held.keyMon)).toFixed(3)} MON</div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn-ghost btn-sm" disabled={!!busy} onClick={() => run("Faucet to custody", () => relay.faucet(custody))}>
              Get 100 tUSD → custody (unlocks token-gated communities)
            </button>
            <button className="btn-ghost btn-sm" disabled={!!busy} onClick={() => run("Faucet to app key", () => relay.faucet(appKey.address))}>
              Get 100 tUSD → app key (for subscriptions)
            </button>
          </div>
        </section>

        <section className="card p-4">
          <h3 className="font-semibold">Identity & keys</h3>
          <dl className="mt-2 grid grid-cols-[120px_1fr] gap-y-1 text-xs">
            <dt className="text-muted">fid</dt><dd>{fid}</dd>
            <dt className="text-muted">custody</dt><dd className="break-all font-mono">{custody}</dd>
            <dt className="text-muted">this app key</dt><dd className="break-all font-mono">{appKey.address}</dd>
            <dt className="text-muted">scope</dt><dd>full (post, follow, communities, feeds, chat, pay)</dd>
          </dl>
          <p className="mt-2 text-xs text-muted">
            This app signs in the background with its own key. Revoking it stops new messages from this key immediately; your identity and follows stay.
          </p>
          <button
            className="btn-ghost btn-sm mt-3 text-bad"
            disabled={!!busy}
            onClick={() =>
              confirm("Revoke this app key and sign out?") &&
              run("Revoke key", async () => {
                await call(deployment.appKeys, appKeysAbi, "revoke", [BigInt(fid), appKey.address.toLowerCase() as Hex]);
                logout();
              })
            }
          >
            Revoke this app key
          </button>
        </section>
        <RecoverySection />
        <RelationsSection />
        {msg && <p className="text-sm text-muted">{msg}</p>}
      </div>
    </Shell>
  );
}

function RelationsSection() {
  const { fid, setRelation, muted, blocked } = useSession();
  const [lists, setLists] = useState<{ muted: Profile[]; blocked: Profile[] } | null>(null);
  // fetch profiles once; membership follows the session's live (optimistic) sets, so undo is instant
  useEffect(() => {
    if (fid) relay.relations(fid).then(setLists);
  }, [fid]);
  if (!lists) return null;
  const shown = {
    muted: lists.muted.filter((p) => muted.has(p.fid)),
    blocked: lists.blocked.filter((p) => blocked.has(p.fid)),
  };
  const row = (p: Profile, kind: "mute" | "block") => (
    <div key={`${kind}${p.fid}`} className="flex items-center gap-2 rounded-xl bg-panel-2 px-3 py-2 text-sm">
      <Avatar fid={p.fid} handle={p.handle} src={p.avatar} size={24} />
      <span className="flex-1">@{p.handle}</span>
      <button className="btn-ghost btn-sm" onClick={() => setRelation(kind, p.fid, false)}>{kind === "mute" ? "Unmute" : "Unblock"}</button>
    </div>
  );
  return (
    <section className="card p-4">
      <h3 className="font-semibold">Muted & blocked</h3>
      <p className="text-xs text-muted">Signed with your key, so every client on the protocol respects them.</p>
      {shown.muted.length + shown.blocked.length === 0 && <p className="mt-2 text-sm text-muted">Nobody yet.</p>}
      <div className="mt-2 space-y-2">
        {shown.blocked.map((p) => row(p, "block"))}
        {shown.muted.map((p) => row(p, "mute"))}
      </div>
    </section>
  );
}

/** Backup passkey = the account's recovery address. Without one, losing the passkey loses the account. */
function RecoverySection() {
  const { profile, custody, addBackupPasskey } = useSession();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (!profile || !custody) return null;
  const hasBackup = !!profile.recovery && profile.recovery.toLowerCase() !== custody.toLowerCase();

  const add = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await addBackupPasskey();
      setMsg("Backup passkey saved. Keep it somewhere other than your main passkey.");
    } catch (e) {
      const m = errMsg(e);
      setMsg(/PRF/i.test(m) ? "This browser's passkey manager can't create Mera passkeys (no PRF support). Try Safari or Chrome." : /NotAllowed|cancel/i.test(m) ? "Passkey prompt was cancelled." : m);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card p-4">
      <h3 className="font-semibold">Account recovery</h3>
      {hasBackup ? (
        <p className="mt-1 text-sm">
          <span className="text-good">✓ Backup passkey set</span>{" "}
          <span className="font-mono text-xs text-muted">
            ({profile.recovery!.slice(0, 6)}…{profile.recovery!.slice(-4)})
          </span>
        </p>
      ) : (
        <p className="mt-1 rounded-xl bg-warn/10 px-3 py-2 text-sm text-warn">
          No backup yet. If you lose your passkey, you lose this account.
        </p>
      )}
      <p className="mt-2 text-xs text-muted">
        A backup passkey can take over your account if your main one is lost. Create it in a different place than your main passkey, for
        example 1Password if your main one is in iCloud Keychain, or a security key. You'll confirm with your current passkey.
      </p>
      <button className={`${hasBackup ? "btn-ghost" : "btn-primary"} btn-sm mt-3`} disabled={busy} onClick={add}>
        {busy ? "Waiting for passkeys…" : hasBackup ? "Replace backup passkey" : "Add backup passkey"}
      </button>
      {msg && <p className="mt-2 text-xs text-muted">{msg}</p>}
    </section>
  );
}
