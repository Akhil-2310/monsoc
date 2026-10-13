import { createHmac, randomUUID } from "node:crypto";
import { keccak256, recoverAddress, toBytes, type Address, type Hex } from "viem";
import { Scopes } from "@monsoc/sdk";
import { config } from "./config";
import { RejectError, signerAuthorized } from "./messages";

const ik = config.imagekit;
export const mediaEnabled = () => !!(ik.publicKey && ik.privateKey && ik.urlEndpoint);

/** What the client signs with its app key to ask for an upload token. */
export const mediaAuthDigest = (fid: number, ts: number): Hex => keccak256(toBytes(`monsoc:media-auth:${fid}:${ts}`));

const usage = new Map<number, { hour: number; count: number }>();

/**
 * Short-lived ImageKit client-upload credentials. Only registered accounts (proved by an app-key
 * signature) get them, rate-limited per fid; the private key never leaves the relay.
 * ImageKit expects signature = HMAC-SHA1(privateKey, token + expire).
 */
export async function mediaAuth(req: { fid: number; ts: number; signer: Address; signature: Hex }) {
  if (!mediaEnabled()) throw new RejectError("media uploads are not configured on this relay");
  const fid = Number(req.fid);
  if (!Number.isInteger(fid) || fid <= 0) throw new RejectError("bad fid");
  if (Math.abs(Date.now() - Number(req.ts)) > 2 * 60_000) throw new RejectError("stale request");
  let recovered: Address;
  try {
    recovered = await recoverAddress({ hash: mediaAuthDigest(fid, Number(req.ts)), signature: req.signature });
  } catch {
    throw new RejectError("bad signature");
  }
  if (recovered.toLowerCase() !== req.signer.toLowerCase()) throw new RejectError("bad signature");
  if (!(await signerAuthorized(fid, recovered, Scopes.POST))) throw new RejectError("signer is not an active app key for this fid");

  const hour = Math.floor(Date.now() / 3_600_000);
  const u = usage.get(fid);
  if (!u || u.hour !== hour) usage.set(fid, { hour, count: 1 });
  else if (++u.count > ik.uploadsPerHour) throw new RejectError("upload limit reached, try again later");

  const token = randomUUID();
  const expire = Math.floor(Date.now() / 1000) + 10 * 60;
  const signature = createHmac("sha1", ik.privateKey).update(token + expire).digest("hex");
  return { token, expire, signature, publicKey: ik.publicKey, urlEndpoint: ik.urlEndpoint, folder: `${ik.folder}/${fid}` };
}
