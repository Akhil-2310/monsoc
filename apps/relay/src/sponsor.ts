import { decodeErrorResult, decodeEventLog, parseEther, type Abi, type Address, type Hex } from "viem";
import {
  forwarderAbi,
  signupAbi,
  identityAbi,
  followsAbi,
  feedsAbi,
  communitiesAbi,
  paymentsAbi,
  anchorAbi,
  appKeysAbi,
  tusdAbi,
  type ForwardRequestData,
  type SignupParams,
} from "@monsoc/sdk";
import { config } from "./config";
import { get, run } from "./db";
import { deployment, publicClient, send, sendValue } from "./chain";
import { RejectError } from "./messages";

/**
 * Gas sponsorship (the "paymaster" role). App keys sign ERC-2771 requests; the relay pays gas,
 * after checking the target is a protocol contract and the fid has budget left today.
 */

const allowed: Record<string, Abi> = {
  [deployment.follows.toLowerCase()]: followsAbi as Abi,
  [deployment.feeds.toLowerCase()]: feedsAbi as Abi,
  [deployment.communities.toLowerCase()]: communitiesAbi as Abi,
  [deployment.payments.toLowerCase()]: paymentsAbi as Abi,
  [deployment.anchor.toLowerCase()]: anchorAbi as Abi,
  [deployment.appKeys.toLowerCase()]: appKeysAbi as Abi,
  [deployment.identity.toLowerCase()]: identityAbi as Abi,
  [deployment.tusd.toLowerCase()]: tusdAbi as Abi,
};

const reject = (m: string): never => {
  throw new RejectError(m);
};

async function fidForSender(addr: Address): Promise<number | null> {
  const a = addr.toLowerCase();
  const key = get<{ fid: number }>("SELECT fid FROM app_keys WHERE signer = ? AND revoked = 0", a);
  if (key) return key.fid;
  const custody = get<{ fid: number }>("SELECT fid FROM users WHERE custody = ?", a);
  if (custody) return custody.fid;
  // the indexer may be a block behind a just-registered key: ask the chain
  const [signerFid, idOf] = await Promise.all([
    publicClient.readContract({ address: deployment.appKeys, abi: appKeysAbi, functionName: "signerFid", args: [addr] }),
    publicClient.readContract({ address: deployment.identity, abi: identityAbi, functionName: "idOf", args: [addr] }),
  ]);
  const fid = Number(signerFid || idOf);
  return fid || null;
}

function chargeBudget(fid: number) {
  const day = Math.floor(Date.now() / 86_400_000);
  const rep = get<{ rep: number }>("SELECT rep FROM reputation WHERE fid = ?", fid)?.rep ?? 0;
  const budget = Math.round(config.sponsorBudget * (1 + 4 * rep));
  const used = get<{ count: number }>("SELECT count FROM sponsor_usage WHERE fid = ? AND day = ?", fid, day)?.count ?? 0;
  if (used >= budget) reject("daily sponsored budget used up");
  run(
    "INSERT INTO sponsor_usage(fid, day, count) VALUES(?,?,1) ON CONFLICT(fid, day) DO UPDATE SET count = count + 1",
    fid,
    day,
  );
}

function revertReason(e: unknown, abi: Abi): string {
  const data = (e as { cause?: { data?: Hex }; data?: Hex })?.cause?.data ?? (e as { data?: Hex }).data;
  if (typeof data === "string") {
    try {
      const d = decodeErrorResult({ abi, data });
      return d.errorName;
    } catch {}
  }
  const msg = (e as Error).message ?? String(e);
  const m = msg.match(/reverted with the following reason:\s*\n?(.*)/) ?? msg.match(/Error: (\w+\(.*?\))/);
  return m?.[1]?.trim() ?? msg.split("\n")[0]!;
}

export async function forward(raw: ForwardRequestData) {
  const req: ForwardRequestData = {
    ...raw,
    value: BigInt(raw.value),
    gas: BigInt(raw.gas),
    deadline: Number(raw.deadline),
  };
  const abi = allowed[req.to.toLowerCase()];
  if (!abi) reject("target is not a protocol contract");
  if (req.value !== 0n) reject("sponsored requests can't carry value; pay MON from your own wallet");
  if (req.gas > 3_000_000n) reject("gas too high");
  const fid = await fidForSender(req.from);
  if (fid === null) reject("sender is not a registered app key or custody");

  const valid = await publicClient.readContract({
    address: deployment.forwarder,
    abi: forwarderAbi,
    functionName: "verify",
    args: [{ ...req, deadline: req.deadline }],
  });
  if (!valid) reject("invalid forward request signature, nonce or deadline");

  // Dry-run the inner call as the app key: our contracts read _msgSender() == from either way,
  // so this surfaces the real revert reason instead of the forwarder's generic FailedCall.
  let estimate = 0n;
  try {
    estimate = await publicClient.estimateGas({ account: req.from, to: req.to, data: req.data });
  } catch (e) {
    reject(revertReason(e, abi!));
  }
  if (estimate > req.gas) reject(`request gas ${req.gas} too low, needs ~${estimate}; sign with a higher gas limit`);

  chargeBudget(fid!);
  const { hash, receipt } = await send({
    address: deployment.forwarder,
    abi: forwarderAbi as Abi,
    functionName: "execute",
    args: [{ ...req, deadline: req.deadline }],
  });
  return { txHash: hash, status: receipt.status };
}

export async function signup(params: SignupParams, signature: Hex) {
  const p = {
    ...params,
    keyType: Number(params.keyType),
    scope: Number(params.scope),
    expiry: BigInt(params.expiry),
    clientFid: BigInt(params.clientFid),
    deadline: BigInt(params.deadline),
  };
  const existing = await publicClient.readContract({
    address: deployment.identity,
    abi: identityAbi,
    functionName: "idOf",
    args: [p.custody],
  });
  if (existing !== 0n) reject("this wallet already has an account");
  if (p.handle) {
    const ok = await publicClient.readContract({
      address: deployment.identity,
      abi: identityAbi,
      functionName: "isValidHandle",
      args: [p.handle],
    });
    if (!ok) reject("handle must be 1-16 chars of a-z, 0-9, _");
    const taken = await publicClient.readContract({
      address: deployment.identity,
      abi: identityAbi,
      functionName: "fidByHandle",
      args: [p.handle],
    });
    if (taken !== 0n) reject("handle taken");
  }
  let result;
  try {
    result = await send({
      address: deployment.signup,
      abi: signupAbi as Abi,
      functionName: "signupFor",
      args: [p, signature],
    });
  } catch (e) {
    reject(revertReason(e, signupAbi as Abi));
  }
  let fid = 0;
  for (const log of result!.receipt.logs) {
    try {
      const ev = decodeEventLog({ abi: identityAbi, data: log.data, topics: log.topics });
      if (ev.eventName === "Registered") fid = Number(ev.args.fid);
    } catch {}
  }
  return { fid, txHash: result!.hash };
}

/** New device: the custody signs AddKey (EIP-712, EOA or ERC-1271) and the relay submits it. */
export async function addKey(p: {
  fid: number;
  keyType: number;
  key: Hex;
  scope: number;
  expiry: string | number;
  clientFid: string | number;
  deadline: string | number;
  signature: Hex;
}) {
  try {
    const { hash } = await send({
      address: deployment.appKeys,
      abi: appKeysAbi as Abi,
      functionName: "addFor",
      args: [BigInt(p.fid), p.keyType, p.key, p.scope, BigInt(p.expiry), BigInt(p.clientFid), BigInt(p.deadline), p.signature],
    });
    return { txHash: hash };
  } catch (e) {
    reject(revertReason(e, appKeysAbi as Abi));
  }
}

const faucetLog = new Map<string, number>();

/** Testnet faucet: tUSD for subscriptions/memberships, plus a little MON on local chains. */
export async function faucet(address: Address) {
  if (!config.faucetEnabled) reject("faucet disabled");
  const last = faucetLog.get(address.toLowerCase()) ?? 0;
  if (Date.now() - last < 60_000) reject("faucet: try again in a minute");
  faucetLog.set(address.toLowerCase(), Date.now());
  const { hash } = await send({
    address: deployment.tusd,
    abi: tusdAbi as Abi,
    functionName: "faucet",
    args: [address, 100_000_000n],
  });
  if (config.chainId === 31337) await sendValue(address, parseEther("5"));
  return { txHash: hash };
}
