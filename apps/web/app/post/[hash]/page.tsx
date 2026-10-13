"use client";
import { use, useCallback, useEffect, useState } from "react";
import type { Hex } from "viem";
import type { PostView } from "@monsoc/sdk";
import { anchorAbi } from "@monsoc/sdk";
import { Shell, PageHeader } from "@/components/Shell";
import { PostCard } from "@/components/PostCard";
import { Composer } from "@/components/Composer";
import { relay, publicClient, deployment } from "@/lib/session";
import { errMsg } from "@/lib/format";

type Proof = { batchId: number; root: Hex; proof: Hex[]; txHash: Hex } | { pending: true };

export default function Thread({ params }: { params: Promise<{ hash: string }> }) {
  const { hash } = use(params);
  const [root, setRoot] = useState<PostView | null>(null);
  const [replies, setReplies] = useState<PostView[]>([]);
  const [proof, setProof] = useState<Proof | null>(null);
  const [verified, setVerified] = useState<boolean | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    relay
      .thread(hash as Hex)
      .then((t) => {
        setRoot(t.root);
        setReplies(t.replies);
      })
      .catch((e) => setErr(errMsg(e)));
    relay.proof(hash as Hex).then(setProof).catch(() => undefined);
  }, [hash]);
  useEffect(load, [load]);

  /** Ask the Anchor contract directly: is this message in the anchored Merkle root? */
  const verify = async () => {
    if (!proof || "pending" in proof) return;
    try {
      const ok = await publicClient.readContract({
        address: deployment.anchor,
        abi: anchorAbi,
        functionName: "verify",
        args: [BigInt(proof.batchId), hash as Hex, proof.proof],
      });
      setVerified(ok);
    } catch (e) {
      setErr(errMsg(e));
    }
  };

  return (
    <Shell>
      <PageHeader title="Thread" />
      {err && <p className="p-4 text-sm text-bad">{err}</p>}
      {root && <PostCard post={root} />}
      {proof && (
        <div className="border-b border-line bg-panel px-4 py-3 text-xs text-muted">
          {"pending" in proof ? (
            <span>⧗ Signed and stored by the relay. Will be anchored on Monad in the next batch (every few minutes).</span>
          ) : (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="text-good">⛓ Anchored in batch #{proof.batchId}</span>
              <span>root {proof.root.slice(0, 10)}…</span>
              <span>tx {proof.txHash.slice(0, 10)}…</span>
              <span>{proof.proof.length}-step proof</span>
              <button className="btn-ghost btn-sm" onClick={verify}>Verify onchain</button>
              {verified !== null && (
                <span className={verified ? "text-good" : "text-bad"}>{verified ? "✓ Anchor.verify() = true" : "✗ not in root"}</span>
              )}
            </div>
          )}
        </div>
      )}
      {root && <Composer parent={root.hash} community={root.community ?? undefined} placeholder="Reply…" onPosted={load} />}
      {replies.map((r) => (
        <div key={r.hash} style={{ paddingLeft: Math.min(r.parent === root?.hash ? 0 : 24, 48) }}>
          <PostCard post={r} compact />
        </div>
      ))}
    </Shell>
  );
}
