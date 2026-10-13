"use client";
import { Logo } from "@/components/Shell";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useSession } from "@/lib/session";
import { meraProvider, deviceProvider, isPrfUnsupported, type CustodyProvider } from "@/lib/custody";
import { errMsg } from "@/lib/format";
import cfg from "@/monsoc.config";

export default function Login() {
  const router = useRouter();
  const { fid, ready, login } = useSession();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hasBrowserKey, setHasBrowserKey] = useState(false);

  useEffect(() => {
    if (ready && fid) router.replace("/");
    setHasBrowserKey(!!localStorage.getItem("monsoc.custody"));
  }, [ready, fid, router]);

  const signIn = async (provider: CustodyProvider) => {
    setBusy(true);
    setErr(null);
    try {
      if (await login(provider)) router.push("/");
      else setErr("No account found for this key. Create one instead.");
    } catch (e) {
      setErr(
        isPrfUnsupported(e)
          ? "This browser's passkey manager can't derive keys from a passkey (no PRF support). Try Safari or Chrome with iCloud Keychain or 1Password."
          : /NotAllowed|cancel/i.test(errMsg(e))
            ? "Passkey prompt was cancelled."
            : errMsg(e),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <div className="mb-8 text-center">
        <Link href="/" className="inline-flex"><Logo size={56} /></Link>
        <h1 className="mt-2 text-2xl font-bold">Log in to {cfg.name}</h1>
        <p className="text-muted">Same identity, same followers, in every app on the protocol.</p>
      </div>
      <div className="card p-6">
        <button className="btn-primary w-full" disabled={busy} onClick={() => signIn(meraProvider)}>
          {busy ? "Waiting for passkey…" : "Log in with passkey"}
        </button>
        {hasBrowserKey && (
          <button className="btn-ghost mt-2 w-full" disabled={busy} onClick={() => signIn(deviceProvider)}>
            Log in with this browser's key
          </button>
        )}
        {err && <p className="mt-3 text-sm text-bad">{err}</p>}
        <p className="mt-5 text-center text-sm text-muted">
          New here? <Link href="/onboarding" className="text-accent hover:underline">Create an account</Link>
        </p>
      </div>
    </div>
  );
}
