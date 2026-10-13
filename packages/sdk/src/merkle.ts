import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import type { Address, Hex } from "viem";

// Leaves match the contracts: keccak256(bytes.concat(keccak256(abi.encode(...)))).

/** Anchor batches: one leaf per message hash. */
export function anchorTree(messageHashes: Hex[]) {
  return StandardMerkleTree.of(
    messageHashes.map((h) => [h]),
    ["bytes32"],
  );
}

export interface PayoutLeaf {
  epoch: bigint;
  token: Address;
  fid: bigint;
  amount: bigint;
}

export function payoutTree(leaves: PayoutLeaf[]) {
  return StandardMerkleTree.of(
    leaves.map((l) => [l.epoch, l.token, l.fid, l.amount]),
    ["uint256", "address", "uint256", "uint256"],
  );
}

export function scoutTree(scores: { fid: bigint; score: bigint }[]) {
  return StandardMerkleTree.of(
    scores.map((s) => [s.fid, s.score]),
    ["uint256", "uint256"],
  );
}

export function proofFor<T extends unknown[]>(tree: StandardMerkleTree<T>, match: (v: T) => boolean): Hex[] | null {
  for (const [i, v] of tree.entries()) if (match(v)) return tree.getProof(i) as Hex[];
  return null;
}
