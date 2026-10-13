"use client";
import { useEffect, useRef, useState } from "react";
import type { Hex } from "viem";
import { extractTags, mediaUrl as displayUrl, TOPICS, type MediaItem } from "@monsoc/sdk";
import { uploadMedia, uploadsEnabled } from "@/lib/media";
import { useSession, relay } from "@/lib/session";
import { errMsg } from "@/lib/format";
import { Avatar } from "./Avatar";
import { Check, FlaskConical, Hash, ImagePlus, Link as LinkIcon, Plus, X } from "lucide-react";
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
  const { fid, profile, send, appKey } = useSession();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [trial, setTrial] = useState(false);
  const [variantB, setVariantB] = useState("");
  const [abTest, setAbTest] = useState(false);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [uploading, setUploading] = useState<{ name: string; progress: number } | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [canUpload, setCanUpload] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [topicsOpen, setTopicsOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    uploadsEnabled().then(setCanUpload);
  }, []);
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
  // topics come from the post itself: #hashtags in the text plus topics picked below
  const tags = [...new Set([...picked, ...extractTags(text)])];
  const extraTags = tags.filter((t) => !picked.includes(t));
  const togglePick = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const pickFiles = async (files: FileList | null) => {
    if (!files || !appKey) return;
    setErr(null);
    for (const file of [...files].slice(0, 4 - media.length)) {
      setUploading({ name: file.name, progress: 0 });
      try {
        const item = await uploadMedia(file, fid, appKey, (p) => setUploading({ name: file.name, progress: p }));
        setMedia((m) => [...m, item]);
      } catch (e) {
        setErr(errMsg(e));
        break;
      }
    }
    setUploading(null);
    if (fileInput.current) fileInput.current.value = "";
  };

  const addLink = () => {
    const url = linkUrl.trim();
    if (!/^(ipfs:\/\/|https:\/\/)/.test(url)) return setErr("Media must be an ipfs:// or https:// link");
    setMedia((m) => [...m, { uri: url, kind: VIDEO.test(url) ? "video" : "image" }]);
    setLinkUrl("");
    setLinkOpen(false);
    setErr(null);
  };

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const attached = media.length ? media : undefined;
      if (parent) {
        await send("reply", { text, parent, community: communityId });
      } else if (trial) {
        if (tags.length === 0) throw new Error("Add at least one #topic so the trial knows which feeds to test in");
        const groupId = abTest ? `ab-${Date.now()}` : undefined;
        const base = { topics: tags, groupId, autoRelease: autoRelease ? { windowHours: 24, beatAverage: true as const } : undefined };
        await send("trial-post", { text, tags, media: attached, community: communityId, trial: { ...base, variant: abTest ? "A" : undefined } });
        if (abTest && variantB.trim()) {
          await send("trial-post", { text: variantB, tags, media: attached, community: communityId, trial: { ...base, variant: "B" } });
        }
      } else {
        await send("post", { text, tags, media: attached, community: communityId });
      }
      setText("");
      setVariantB("");
      setTrial(false);
      setAbTest(false);
      setMedia([]);
      setLinkOpen(false);
      setPicked([]);
      onPosted?.();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-b border-line px-5 py-4">
      <div className="flex gap-3">
        <Avatar fid={fid} handle={profile?.handle} src={profile?.avatar} size={42} />
        <div className="flex-1">
          <textarea
            className="w-full resize-none bg-transparent pt-2 text-[17px] leading-relaxed outline-none placeholder:text-muted"
            rows={parent ? 2 : 2}
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
          {!parent && (topicsOpen || tags.length > 0) && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(topicsOpen ? TOPICS : TOPICS.filter((t) => picked.includes(t.id))).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => togglePick(t.id)}
                  className={`chip border transition ${picked.includes(t.id) ? "border-transparent bg-accent text-on-accent" : "border-line bg-panel text-muted hover:border-accent/40 hover:text-text"}`}
                >
                  {picked.includes(t.id) ? <Check size={11} /> : <Plus size={11} />}
                  {t.label}
                </button>
              ))}
              {extraTags.map((t) => (
                <span key={t} className="chip bg-accent-soft text-accent">#{t}</span>
              ))}
            </div>
          )}
          {media.length > 0 && (
            <div className={`mt-2 grid gap-2 ${media.length > 1 ? "grid-cols-2" : ""}`}>
              {media.map((m, i) => (
                <div key={m.uri} className="relative overflow-hidden rounded-xl border border-line bg-black">
                  {m.kind === "video" ? (
                    <video src={displayUrl(m.uri)} className="max-h-64 w-full object-contain" muted playsInline controls />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={displayUrl(m.uri, { w: 800 })} alt="" className="max-h-64 w-full object-cover" />
                  )}
                  <button
                    className="absolute right-2 top-2 rounded-full bg-black/70 p-1 text-white backdrop-blur hover:bg-black"
                    onClick={() => setMedia((all) => all.filter((_, j) => j !== i))}
                    title="Remove"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {uploading && (
            <div className="mt-2 rounded-xl border border-line p-2 text-xs text-muted">
              Uploading {uploading.name}… {Math.round(uploading.progress * 100)}%
              <div className="mt-1 h-1 overflow-hidden rounded bg-panel-2">
                <div className="h-full bg-accent transition-all" style={{ width: `${uploading.progress * 100}%` }} />
              </div>
            </div>
          )}
          {linkOpen && (
            <div className="mt-2 flex gap-2">
              <input
                className="input"
                placeholder="https://… or ipfs://… link to an image or video"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addLink()}
              />
              <button className="btn-ghost btn-sm" onClick={addLink}>Add</button>
            </div>
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
          <div className="mt-3 flex min-w-0 items-center gap-0.5 border-t border-line pt-2.5">
            {!parent && (
              <>
                <input ref={fileInput} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => pickFiles(e.target.files)} />
                {canUpload && (
                  <ToolButton label="Photo or video" disabled={!!uploading || media.length >= 4} onClick={() => fileInput.current?.click()}>
                    <ImagePlus size={19} />
                  </ToolButton>
                )}
                <ToolButton label="Attach by link" on={linkOpen} disabled={media.length >= 4} onClick={() => setLinkOpen(!linkOpen)}>
                  <LinkIcon size={18} />
                </ToolButton>
                <ToolButton label="Topics" on={topicsOpen} onClick={() => setTopicsOpen(!topicsOpen)}>
                  <Hash size={18} />
                </ToolButton>
                {cfg.plugins.trials && (
                  <ToolButton label="Trial: test with non-followers first" on={trial} onClick={() => setTrial(!trial)}>
                    <FlaskConical size={18} />
                  </ToolButton>
                )}
              </>
            )}
            {!parent && community === undefined && myCommunities.length > 0 && (
              <select
                className="ml-1 hidden min-w-0 max-w-[40%] truncate rounded-full border border-line bg-panel px-2.5 py-1 text-xs font-medium text-muted sm:block"
                value={communityId ?? ""}
                onChange={(e) => setCommunityId(e.target.value ? Number(e.target.value) : undefined)}
              >
                <option value="">Everyone</option>
                {myCommunities.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            )}
            <span className="flex-1" />
            <span className={`mr-2 hidden text-xs tabular-nums sm:inline ${text.length > 900 ? "text-warn" : "text-muted"}`}>{text.length > 0 && 1024 - text.length}</span>
            <button className="btn-primary shrink-0 px-5" disabled={busy || !!uploading || (!text.trim() && media.length === 0) || (abTest && !variantB.trim())} onClick={submit}>
              {busy ? "Signing…" : parent ? "Reply" : trial ? "Start trial" : "Post"}
            </button>
          </div>
          {err && <p className="mt-1 text-xs text-bad">{err}</p>}
        </div>
      </div>
    </div>
  );
}

function ToolButton({ label, on, disabled, onClick, children }: { label: string; on?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-full p-2 transition disabled:opacity-40 ${on ? "bg-accent-soft text-accent" : "text-accent/80 hover:bg-accent-soft hover:text-accent"}`}
    >
      {children}
    </button>
  );
}
