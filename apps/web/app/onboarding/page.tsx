"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { CommunityInfo, Profile } from "@monsoc/sdk";
import { communitiesAbi, followsAbi } from "@monsoc/sdk";
import { useSession, relay, deployment } from "@/lib/session";
import { providers, deviceProvider, isPrfUnsupported, type CustodyProvider } from "@/lib/custody";
import { Avatar } from "@/components/Avatar";
import { errMsg } from "@/lib/format";
import cfg from "@/monsoc.config";

type Suggestions = {
  communities: (CommunityInfo & { reason: string })[];
  people: (Profile & { reason: string })[];
  starterPacks: { id: string; name: string; fids: number[] }[];
};

export default function Onboarding() {
  const router = useRouter();
  const { fid, custody, signup, login, call } = useSession();
  const [step, setStep] = useState<"account" | "seed">("account");
  const [handle, setHandle] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sugg, setSugg] = useState<Suggestions | null>(null);
  const [pickC, setPickC] = useState<Set<number>>(new Set());
  const [pickP, setPickP] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (fid && custody && step === "account") setStep("seed");
  }, [fid, custody, step]);

  useEffect(() => {
    if (step !== "seed" || !custody) return;
    relay.onboarding(custody).then((s) => {
      setSugg(s);
      // pre-select: every community from your wallet + the top open ones; people with overlap
      setPickC(new Set(s.communities.slice(0, 4).map((c) => c.id)));
      setPickP(new Set(s.people.slice(0, 6).map((p) => p.fid).filter((f) => f !== fid)));
    });
  }, [step, custody, fid]);

  const [prfFailed, setPrfFailed] = useState(false);
  const explain = (e: unknown) => {
    if (isPrfUnsupported(e)) setPrfFailed(true);
    return isPrfUnsupported(e)
      ? "This browser's passkey manager can't derive keys from a passkey (no PRF support)."
      : (e as { name?: string })?.name === "NotAllowedError" || /NotAllowed|cancel/i.test(errMsg(e))
        ? "Passkey prompt was cancelled."
        : errMsg(e);
  };

  const create = async (provider: CustodyProvider) => {
    setBusy(true);
    setErr(null);
    try {
      // check the handle before the passkey prompt, so nobody makes a passkey for a taken name
      const taken = await relay.user(handle).then(() => true, () => false);
      if (taken) throw new Error(`@${handle} is taken`);
      await signup(provider, handle);
      setStep("seed");
    } catch (e) {
      setErr(explain(e));
    } finally {
      setBusy(false);
    }
  };

  const signIn = async (provider: CustodyProvider) => {
    setBusy(true);
    setErr(null);
    try {
      if (await login(provider)) router.push("/");
      else setErr("No account for this passkey yet. Pick a handle to create one.");
    } catch (e) {
      setErr(explain(e));
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    if (!fid) return;
    setBusy(true);
    setErr(null);
    try {
      const people = [...pickP].filter((p) => p !== fid);
      if (people.length) await call(deployment.follows, followsAbi, "followBatch", [BigInt(fid), people.map(BigInt)]);
      for (const cid of pickC) {
        const c = sugg?.communities.find((x) => x.id === cid);
        if (c && (c.joinType === "open" || c.joinType === "token"))
          await call(deployment.communities, communitiesAbi, "join", [BigInt(cid), BigInt(fid)]).catch(() => undefined);
      }
      router.push("/");
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (set: Set<number>, v: number, fn: (s: Set<number>) => void) => {
    const n = new Set(set);
    n.has(v) ? n.delete(v) : n.add(v);
    fn(n);
  };

  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <div className="mb-8 text-center">
        <div className="text-4xl text-accent">◉</div>
        <h1 className="mt-2 text-2xl font-bold">{cfg.name}</h1>
        <p className="text-muted">{cfg.tagline}</p>
      </div>

      {step === "account" && (
        <div className="card p-6">
          <h2 className="text-lg font-semibold">Create your account</h2>
          <p className="mt-1 text-sm text-muted">
            One signature creates your onchain identity and authorizes this app. No seed phrase, no gas, no wallet popups after this.
          </p>
          <div className="mt-4 flex items-center rounded-xl border border-line bg-panel-2 px-3">
            <span className="text-muted">@</span>
            <input
              className="flex-1 bg-transparent px-1 py-2 text-sm outline-none"
              placeholder="handle"
              maxLength={16}
              value={handle}
              onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
            />
          </div>
          {providers.map((p, n) => (
            <div key={p.id} className={n ? "mt-4 border-t border-line pt-4" : ""}>
              <button className={`${n ? "btn-ghost" : "btn-primary"} mt-3 w-full`} disabled={busy || !handle} onClick={() => create(p)}>
                {busy ? "Waiting for passkey…" : n ? `Create with ${p.label}` : "Create account with passkey"}
              </button>
              <button className="btn-ghost mt-2 w-full" disabled={busy} onClick={() => signIn(p)}>
                {n ? `Sign in with ${p.label}` : "Sign in with passkey"}
              </button>
            </div>
          ))}
          <p className="mt-3 text-center text-sm text-muted">
            Already have an account? <a href="/login" className="text-accent hover:underline">Log in</a>
          </p>
          <p className="mt-3 text-[11px] text-muted">
            Your passkey derives your account on this device (via Mera). Nothing is stored on a server, and the same passkey restores your account on
            any device it syncs to.
          </p>
          {err && <p className="mt-3 text-sm text-bad">{err}</p>}
          {prfFailed && !providers.includes(deviceProvider) && (
            <div className="mt-4 rounded-xl border border-warn/40 bg-warn/10 p-3 text-xs">
              <p>
                Passkeys work in Chrome or Safari with iCloud Keychain, 1Password or Google Password Manager. Or continue here with a key stored in
                this browser: it works the same, but it can't be restored on another device, and clearing site data loses it.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button className="btn-primary btn-sm" disabled={busy || !handle} onClick={() => create(deviceProvider)}>
                  Create with this browser's key
                </button>
                <button className="btn-ghost btn-sm" disabled={busy} onClick={() => signIn(deviceProvider)}>
                  Sign in with this browser's key
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {step === "seed" && (
        <div className="space-y-4">
          <div className="card p-5">
            <h2 className="text-lg font-semibold">Your communities</h2>
            <p className="text-sm text-muted">Based on the tokens and apps in your wallet, plus what's active right now.</p>
            {!sugg && <p className="mt-3 text-sm text-muted">Reading your wallet…</p>}
            {sugg?.communities.length === 0 && <p className="mt-3 text-sm text-muted">No communities yet. You can start one after this.</p>}
            <div className="mt-3 space-y-2">
              {sugg?.communities.map((c) => (
                <label key={c.id} className="flex cursor-pointer items-center gap-3 rounded-xl border border-line p-3 hover:bg-panel-2">
                  <input type="checkbox" checked={pickC.has(c.id)} disabled={c.joinType === "invite" || c.joinType === "paid"} onChange={() => toggle(pickC, c.id, setPickC)} />
                  <div className="flex-1">
                    <div className="text-sm font-medium">{c.name}</div>
                    <div className="text-xs text-muted">{c.reason}</div>
                  </div>
                  <span className="chip bg-panel-2 text-muted">{c.joinType}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="card p-5">
            <h2 className="text-lg font-semibold">People to follow</h2>
            {sugg && sugg.people.filter((p) => p.fid !== fid).length === 0 && <p className="mt-2 text-sm text-muted">You're early. Nobody to suggest yet.</p>}
            <div className="mt-2 flex flex-wrap gap-2">
              {sugg?.starterPacks.map((sp) => (
                <button key={sp.id} className="btn-ghost btn-sm" onClick={() => setPickP(new Set([...pickP, ...sp.fids]))}>
                  + {sp.name} pack
                </button>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {sugg?.people
                .filter((p) => p.fid !== fid)
                .map((p) => (
                  <label key={p.fid} className="flex cursor-pointer items-center gap-2 rounded-xl border border-line p-2 hover:bg-panel-2">
                    <input type="checkbox" checked={pickP.has(p.fid)} onChange={() => toggle(pickP, p.fid, setPickP)} />
                    <Avatar fid={p.fid} handle={p.handle} size={28} />
                    <div className="min-w-0 text-sm">
                      <div className="truncate font-medium">@{p.handle}</div>
                      <div className="truncate text-xs text-muted">{p.reason}</div>
                    </div>
                  </label>
                ))}
            </div>
          </div>
          <button className="btn-primary w-full" disabled={busy} onClick={finish}>
            {busy ? "Following & joining…" : pickP.size || pickC.size ? `Follow ${pickP.size} · join ${pickC.size} · enter feed` : "Enter feed"}
          </button>
          {err && <p className="text-sm text-bad">{err}</p>}
        </div>
      )}
    </div>
  );
}
