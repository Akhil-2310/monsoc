"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowUp, Bookmark, Loader2, Sparkles, Upload, X } from "lucide-react";
import type { AiFeedSpec, FeedDefinition, FeedInfo } from "@monsoc/sdk";
import { relay } from "@/lib/session";
import { errMsg } from "@/lib/format";

export type AiFeed = { id: string; spec: AiFeedSpec; definition: FeedDefinition };

const SAVED_KEY = "monsoc.aiFeeds";
export const FEED_DRAFT_KEY = "monsoc.feedDraft";

const EXAMPLES = ["Posts about sports", "Cricket and F1 from new people", "Real conversations about AI this week", "Latest crypto news, no memes"];

export function loadSavedAiFeeds(): AiFeed[] {
  try {
    return JSON.parse(localStorage.getItem(SAVED_KEY) ?? "[]") as AiFeed[];
  } catch {
    return [];
  }
}
export function saveAiFeeds(list: AiFeed[]) {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(list.slice(0, 12)));
  } catch {}
}

/** Wrap an AI-built definition so the normal FeedView runs it (rule feed, ranked in the browser). */
export function aiFeedInfo(f: AiFeed): FeedInfo {
  return {
    id: -1_000_000 - (Math.abs([...f.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)) % 1_000_000),
    ownerFid: 0,
    ownerHandle: null,
    kind: "rule",
    name: f.definition.name,
    description: f.spec.summary,
    uri: `ai:${f.id}`,
    defHash: "0x",
    version: 1,
    priceUsd: 0,
    creatorShareBps: 0,
    discoveryBps: Math.round(f.definition.discovery * 10_000),
    active: true,
    definition: f.definition,
    endpoint: null,
    subscribers: 0,
  };
}

/**
 * "Tell me what you want to see": the relay's AI turns the sentence into feed rules, and the regular
 * feed engine picks the posts. With a feed active, the same box refines it ("more cricket, less football").
 */
export function AskFeed({
  active,
  saved,
  onResult,
  onClear,
  onSave,
}: {
  active: AiFeed | null;
  saved: boolean;
  onResult: (f: AiFeed) => void;
  onClear: () => void;
  onSave: () => void;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    relay.aiStatus().then((s) => setEnabled(s.enabled), () => setEnabled(false));
  }, []);
  if (!enabled) return null;

  const ask = async (prompt: string) => {
    const p = prompt.trim();
    if (!p || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const { spec, definition } = await relay.aiFeed(p, active?.spec);
      onResult({ id: active?.id ?? `${Date.now().toString(36)}`, spec, definition });
      setText("");
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const publish = () => {
    if (!active) return;
    try {
      sessionStorage.setItem(FEED_DRAFT_KEY, JSON.stringify(active.definition));
    } catch {}
    router.push("/feeds?draft=1");
  };

  return (
    <div className="border-b border-line px-4 py-3">
      <form
        className="field gap-2 py-1"
        onSubmit={(e) => {
          e.preventDefault();
          ask(text);
        }}
      >
        <Sparkles size={16} className="shrink-0 text-accent" />
        <input
          className="min-w-0 flex-1 bg-transparent py-1.5 text-sm outline-none placeholder:text-muted"
          placeholder={active ? "Refine it: “more cricket, less football”" : "Tell me what you want to see…"}
          value={text}
          maxLength={300}
          onChange={(e) => setText(e.target.value)}
          aria-label="Describe a feed"
        />
        <button type="submit" disabled={!text.trim() || busy} className="btn-primary h-8 w-8 shrink-0 p-0" aria-label="Show posts">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <ArrowUp size={15} />}
        </button>
      </form>

      {!active && !busy && (
        <div className="mt-2 flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
          {EXAMPLES.map((ex) => (
            <button key={ex} className="chip shrink-0 border border-line bg-panel py-1 text-muted hover:text-text" onClick={() => ask(ex)}>
              {ex}
            </button>
          ))}
        </div>
      )}

      {active && (
        <div className="mt-2.5 rounded-xl bg-accent-soft px-3 py-2.5">
          <div className="flex items-start gap-2">
            <p className="min-w-0 flex-1 text-sm">
              <span className="font-semibold text-accent">Showing:</span> {active.spec.summary}
            </p>
            <button className="text-muted hover:text-text" onClick={onClear} aria-label="Back to your feed">
              <X size={16} />
            </button>
          </div>
          {active.spec.notes && <p className="mt-1 text-xs text-muted">Note: {active.spec.notes}</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            <button className="btn-ghost btn-sm" disabled={saved} onClick={onSave}>
              <Bookmark size={13} fill={saved ? "currentColor" : "none"} /> {saved ? "Saved to your feeds" : "Save as my feed"}
            </button>
            <button className="btn-ghost btn-sm" onClick={publish} title="Register it onchain so anyone can use it">
              <Upload size={13} /> Publish to marketplace
            </button>
          </div>
        </div>
      )}
      {err && <p className="mt-2 text-xs text-bad">{err}</p>}
    </div>
  );
}
