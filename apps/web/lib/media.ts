"use client";
import { bytesToHex, keccak256, toBytes, type LocalAccount } from "viem";
import type { MediaItem } from "@monsoc/sdk";
import { relay } from "./session";

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

let enabled: Promise<boolean> | null = null;
/** Whether this relay has ImageKit configured (cached per page load). */
export function uploadsEnabled(): Promise<boolean> {
  enabled ??= relay.mediaConfig().then((c) => c.enabled, () => false);
  return enabled;
}

async function sha256(file: File) {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())));
}

async function dimensions(file: File, kind: MediaItem["kind"]) {
  const url = URL.createObjectURL(file);
  try {
    if (kind === "image") {
      const bmp = await createImageBitmap(file);
      return { width: bmp.width, height: bmp.height };
    }
    const v = document.createElement("video");
    v.preload = "metadata";
    v.src = url;
    await new Promise((ok, fail) => ((v.onloadedmetadata = ok), (v.onerror = fail)));
    return { width: v.videoWidth, height: v.videoHeight, durationMs: Math.round(v.duration * 1000) };
  } catch {
    return {};
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Uploads a file straight from the browser to ImageKit. The relay only signs a short-lived token
 * (after checking our app key), so files never pass through it and its private key stays server-side.
 */
export async function uploadMedia(
  file: File,
  fid: number,
  appKey: LocalAccount,
  onProgress?: (fraction: number) => void,
): Promise<MediaItem> {
  const kind: MediaItem["kind"] = file.type.startsWith("video/") ? "video" : file.type.startsWith("image/") ? "image" : (() => {
    throw new Error("Only images and videos can be uploaded");
  })();
  if (file.size > (kind === "image" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES))
    throw new Error(`File too large (max ${kind === "image" ? "20" : "100"} MB)`);

  const ts = Date.now();
  const signature = await appKey.sign!({ hash: keccak256(toBytes(`monsoc:media-auth:${fid}:${ts}`)) });
  const [auth, hash, dims] = await Promise.all([
    relay.mediaAuth({ fid, ts, signer: appKey.address, signature }),
    sha256(file),
    dimensions(file, kind),
  ]);

  const form = new FormData();
  form.append("file", file);
  form.append("fileName", file.name.replace(/[^\w.-]/g, "_").slice(-80) || "upload");
  form.append("publicKey", auth.publicKey);
  form.append("signature", auth.signature);
  form.append("expire", String(auth.expire));
  form.append("token", auth.token);
  form.append("folder", auth.folder);
  form.append("useUniqueFileName", "true");

  const res = await new Promise<{ url: string; fileType?: string }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "https://upload.imagekit.io/api/v1/files/upload");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let body: { url?: string; message?: string } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status >= 200 && xhr.status < 300 && body.url) resolve(body as { url: string });
      else reject(new Error(body.message ?? `upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("upload failed: network error"));
    xhr.send(form);
  });
  onProgress?.(1);
  return { uri: res.url, kind, sha256: hash, mime: file.type, ...dims };
}
