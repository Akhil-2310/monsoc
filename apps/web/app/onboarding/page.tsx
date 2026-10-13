"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { CommunityInfo, Profile } from "@monsoc/sdk";
import { communitiesAbi, followsAbi } from "@monsoc/sdk";
import { useSession, relay, deployment } from "@/lib/session";
import { providers } from "@/lib/custody";
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
  const { fid, custody, signup, login, loginDemo, call } = useSession();
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

  const create = async () => {
    setBusy(true);
    setErr(null);
    try {
      await signup(providers[0]!, handle);
      setStep("seed");
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const signIn = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (await login(providers[0]!)) router.push("/");
      else setErr("No account for this device yet. Pick a handle to create one.");
    } catch (e) {
      setErr(errMsg(e));
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
          <button className="btn-primary mt-3 w-full" disabled={busy || !handle} onClick={create}>
            {busy ? "Creating…" : "Create account"}
          </button>
          <button className="btn-ghost mt-2 w-full" disabled={busy} onClick={signIn}>
            I already have an account on this device
          </button>
          <p className="mt-3 text-[11px] text-muted">
            Signing with: {providers[0]!.label}. A passkey wallet plugs in at <code>apps/web/lib/custody.ts</code>.
          </p>
          {cfg.demoLogins && (
            <div className="mt-5 border-t border-line pt-4">
              <p className="mb-2 text-xs text-muted">Demo: try a seeded account</p>
              <div className="flex flex-wrap gap-2">
                {cfg.demoHandles.map((h) => (
                  <button
                    key={h}
                    className="btn-ghost btn-sm"
                    onClick={() =>
                      loginDemo(h)
                        .then(() => router.push("/"))
                        .catch((e) => setErr(errMsg(e)))
                    }
                  >
                    @{h}
                  </button>
                ))}
              </div>
            </div>
          )}
          {err && <p className="mt-3 text-sm text-bad">{err}</p>}
        </div>
      )}

      {step === "seed" && (
        <div className="space-y-4">
          <div className="card p-5">
            <h2 className="text-lg font-semibold">Your communities</h2>
            <p className="text-sm text-muted">Based on the tokens and apps in your wallet, plus what's active right now.</p>
            {!sugg && <p className="mt-3 text-sm text-muted">Reading your wallet…</p>}
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
            {busy ? "Following & joining…" : `Follow ${pickP.size} · join ${pickC.size} · enter feed`}
          </button>
          {err && <p className="text-sm text-bad">{err}</p>}
        </div>
      )}
    </div>
  );
}
