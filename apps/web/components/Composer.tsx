"use client";
import { useEffect, useState } from "react";
import type { Hex } from "viem";
import { extractTags } from "@monsoc/sdk";
import { useSession, relay } from "@/lib/session";
import { errMsg } from "@/lib/format";
import { Avatar } from "./Avatar";
import cfg from "@/monsoc.config";

const VIDEO = /\.(mp4|webm|mov|m3u8)(\?|$)/i;

export function Composer({
  parent,
  community,
  onPosted,
  placeholder = "What are you building?",
}: {
  parent?: Hex;
  community?: number;
  onPosted?: () => void;
  placeholder?: string;
}) {
  const { fid, profile, send } = useSession();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [trial, setTrial] = useState(false);
  const [variantB, setVariantB] = useState("");
  const [abTest, setAbTest] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [mediaUrl, setMediaUrl] = useState("");
  const [autoRelease, setAutoRelease] = useState(true);
  const [communityId, setCommunityId] = useState<number | undefined>(community);
  const [myCommunities, setMyCommunities] = useState<{ id: number; name: string }[]>([]);

  useEffect(() => {
    if (!fid || community !== undefined || parent) return;
    Promise.all([relay.memberships(fid), relay.communities()]).then(([ms, all]) => {
      const ids = new Set(ms.map((m) => m.communityId));
      setMyCommunities(all.filter((c) => ids.has(c.id)).map((c) => ({ id: c.id, name: c.name })));
    });
  }, [fid, community, parent]);

  if (!fid) return null;
  const tags = extractTags(text);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const url = mediaUrl.trim();
      if (url && !/^(ipfs:\/\/|https:\/\/)/.test(url)) throw new Error("Media must be an ipfs:// or https:// link");
      const media = url ? [{ uri: url, kind: VIDEO.test(url) ? ("video" as const) : ("image" as const) }] : undefined;
      if (parent) {
        await send("reply", { text, parent, community: communityId });
      } else if (trial) {
        if (tags.length === 0) throw new Error("Add at least one #topic so the trial knows which feeds to test in");
        const groupId = abTest ? `ab-${Date.now()}` : undefined;
        const base = { topics: tags, groupId, autoRelease: autoRelease ? { windowHours: 24, beatAverage: true as const } : undefined };
        await send("trial-post", { text, tags, media, community: communityId, trial: { ...base, variant: abTest ? "A" : undefined } });
        if (abTest && variantB.trim()) {
          await send("trial-post", { text: variantB, tags, media, community: communityId, trial: { ...base, variant: "B" } });
        }
      } else {
        await send("post", { text, tags, media, community: communityId });
      }
      setText("");
      setVariantB("");
      setTrial(false);
      setAbTest(false);
      setMediaUrl("");
      setMediaOpen(false);
      onPosted?.();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-b border-line px-4 py-3">
      <div className="flex gap-3">
        <Avatar fid={fid} handle={profile?.handle} src={profile?.avatar} />
        <div className="flex-1">
          <textarea
            className="w-full resize-none bg-transparent text-[15px] outline-none placeholder:text-muted"
            rows={parent ? 2 : 3}
            maxLength={1024}
            placeholder={abTest ? "Variant A: your first hook" : placeholder}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {abTest && (
            <textarea
              className="mt-2 w-full resize-none rounded-xl border border-line bg-panel-2 p-2 text-[15px] outline-none placeholder:text-muted"
              rows={2}
              placeholder="Variant B: a different hook or caption (same #topics)"
              value={variantB}
              onChange={(e) => setVariantB(e.target.value)}
            />
          )}
          {mediaOpen && (
            <input
              className="input mt-2"
              placeholder="ipfs://… or https://… link to an image or video (mp4, webm)"
              value={mediaUrl}
              onChange={(e) => setMediaUrl(e.target.value)}
            />
          )}
          {trial && (
            <div className="mt-2 rounded-xl border border-accent/40 bg-accent-soft p-3 text-xs text-muted">
              <p className="text-text">
                <b>Trial:</b> shown only in discovery slots of {tags.length ? tags.map((t) => `#${t}`).join(", ") : "your #topic"} feeds, to people who
                don't follow you. Your followers won't see it until you release it.
              </p>
              <div className="mt-2 flex flex-wrap gap-4">
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={abTest} onChange={(e) => setAbTest(e.target.checked)} /> A/B test two versions
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={autoRelease} onChange={(e) => setAutoRelease(e.target.checked)} /> Auto-release if it beats my average within 24h
                </label>
              </div>
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {!parent && cfg.plugins.trials && (
              <button className={`btn-ghost btn-sm ${trial ? "border-accent text-accent" : ""}`} onClick={() => setTrial(!trial)}>
                ◎ Trial
              </button>
            )}
            {!parent && (
              <button className={`btn-ghost btn-sm ${mediaOpen ? "border-accent text-accent" : ""}`} onClick={() => setMediaOpen(!mediaOpen)} title="Attach an image or video by link">
                ▶ Media
              </button>
            )}
            {!parent && community === undefined && myCommunities.length > 0 && (
              <select
                className="rounded-full border border-line bg-panel-2 px-3 py-1 text-xs"
                value={communityId ?? ""}
                onChange={(e) => setCommunityId(e.target.value ? Number(e.target.value) : undefined)}
              >
                <option value="">Everyone</option>
                {myCommunities.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            )}
            {tags.length > 0 && <span className="text-xs text-muted">{tags.map((t) => `#${t}`).join(" ")}</span>}
            <button className="btn-primary ml-auto" disabled={busy || !text.trim() || (abTest && !variantB.trim())} onClick={submit}>
              {busy ? "Signing…" : parent ? "Reply" : trial ? "Start trial" : "Post"}
            </button>
          </div>
          {err && <p className="mt-1 text-xs text-bad">{err}</p>}
        </div>
      </div>
    </div>
  );
}
