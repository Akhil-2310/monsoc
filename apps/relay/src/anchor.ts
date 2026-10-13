import { decodeEventLog, type Hex } from "viem";
import { anchorAbi, anchorTree } from "@monsoc/sdk";
import { config } from "./config";
import { all, get, run, tx } from "./db";
import { deployment, send } from "./chain";

/**
 * Every few minutes: Merkle-root all new (non-chat) messages and post the root to the Anchor
 * contract. The batch's message list is served at /v1/batches/by-root/:root so anyone can rebuild it.
 */
export async function anchorOnce(): Promise<number | null> {
  const rows = all<{ relay_seq: number; hash: Hex }>(
    "SELECT relay_seq, hash FROM messages WHERE anchor_batch IS NULL AND type != 'chat' ORDER BY relay_seq LIMIT 10000",
  );
  if (rows.length === 0) return null;
  const tree = anchorTree(rows.map((r) => r.hash));
  const root = tree.root as Hex;
  const fromSeq = rows[0]!.relay_seq;
  const toSeq = rows[rows.length - 1]!.relay_seq;
  const dataUri = `${config.publicUrl}/v1/batches/by-root/${root}`;

  const { hash, receipt } = await send({
    address: deployment.anchor,
    abi: anchorAbi,
    functionName: "anchor",
    args: [root, BigInt(rows.length), BigInt(fromSeq), BigInt(toSeq), dataUri],
  });
  let batchId = -1;
  for (const log of receipt.logs) {
    try {
      const ev = decodeEventLog({ abi: anchorAbi, data: log.data, topics: log.topics });
      if (ev.eventName === "Anchored") batchId = Number(ev.args.batchId);
    } catch {}
  }
  tx(() => {
    run(
      "INSERT INTO batches(id, root, count, from_seq, to_seq, tx, at) VALUES(?,?,?,?,?,?,?)",
      batchId,
      root,
      rows.length,
      fromSeq,
      toSeq,
      hash,
      Date.now(),
    );
    const mark = run.bind(null, "UPDATE messages SET anchor_batch = ? WHERE hash = ?");
    for (const r of rows) mark(batchId, r.hash);
  });
  console.log(`[anchor] batch ${batchId}: ${rows.length} messages, root ${root.slice(0, 10)}…`);
  return batchId;
}

export function batchHashes(batchId: number): Hex[] {
  return all<{ hash: Hex }>("SELECT hash FROM messages WHERE anchor_batch = ? ORDER BY relay_seq", batchId).map(
    (r) => r.hash,
  );
}

export function proofFor(messageHash: Hex) {
  const m = get<{ anchor_batch: number | null }>("SELECT anchor_batch FROM messages WHERE hash = ?", messageHash);
  if (!m) return null;
  if (m.anchor_batch === null) return { pending: true as const };
  const b = get<{ id: number; root: Hex; tx: Hex }>("SELECT id, root, tx FROM batches WHERE id = ?", m.anchor_batch)!;
  const tree = anchorTree(batchHashes(b.id));
  let proof: Hex[] = [];
  for (const [i, v] of tree.entries()) if (v[0] === messageHash) proof = tree.getProof(i) as Hex[];
  return { batchId: b.id, root: b.root, proof, txHash: b.tx };
}

export function startAnchoring() {
  const loop = async () => {
    try {
      await anchorOnce();
    } catch (e) {
      console.error("[anchor]", (e as Error).message);
    }
    setTimeout(loop, config.anchorIntervalMs);
  };
  setTimeout(loop, config.anchorIntervalMs);
}
