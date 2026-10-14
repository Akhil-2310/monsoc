"use client";
import { LayoutGrid, Sparkles, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { feedHash, validateFeed, feedsAbi, DEFAULT_FEEDS, type FeedDefinition, type FeedInfo } from "@monsoc/sdk";
import { Shell, PageHeader } from "@/components/Shell";
import { useSession, relay, deployment } from "@/lib/session";
import { isTopicFeed, STYLE_KEY, TOPIC_KEY } from "@/lib/feeds";
import { usd, pct, errMsg } from "@/lib/format";

const TEMPLATE: FeedDefinition = {
  version: 1,
  name: "My topic feed",
  description: "Posts tagged #ai from people I follow, replies weighted 2x, no engagement bait, 15% discovery.",
  sources: { following: true, topics: ["ai"] },
  filters: { includeTags: ["ai"], excludeLabels: ["spam", "engagement-bait"] },
  weights: { likes: 1, replies: 2, reposts: 1, recencyHalfLifeHours: 12 },
  discovery: 0.15,
};

const toDataUri = (o: unknown) => `data:application/json;base64,${btoa(unescape(encodeURIComponent(JSON.stringify(o))))}`;

export default function Feeds() {
  const { fid, call } = useSession();
  const [feeds, setFeeds] = useState<FeedInfo[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [json, setJson] = useState(JSON.stringify(TEMPLATE, null, 2));
  const [price, setPrice] = useState("0");
  const [share, setShare] = useState("60");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = () => relay.feeds().then(setFeeds).catch((e) => setErr(errMsg(e)));
  useEffect(() => {
    load();
  }, []);

  let parsed: FeedDefinition | null = null;
  let errors: string[] = [];
  try {
    parsed = JSON.parse(json);
    errors = validateFeed(parsed!);
  } catch {
    errors = ["invalid JSON"];
  }

  const publish = async () => {
    if (!fid || !parsed || errors.length) return;
    setBusy(true);
    setErr(null);
    try {
      const uri = toDataUri({ name: parsed.name, description: parsed.description, definition: parsed });
      await call(deployment.feeds, feedsAbi, "create", [
        BigInt(fid),
        0,
        uri,
        feedHash(parsed),
        BigInt(Math.round(Number(price) * 1e6)),
        Math.round(Number(share) * 100),
        Math.round(parsed.discovery * 10_000),
      ]);
      setCreating(false);
      setTimeout(load, 1500);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      <PageHeader
        title="Feed marketplace"
        sub="Anyone can publish a ranking algorithm. Switch with one tap."
        right={fid && <button className="btn-primary btn-sm" onClick={() => setCreating(!creating)}>{creating ? "Close" : "+ Publish a feed"}</button>}
      />

      {creating && (
        <div className="border-b border-line p-4">
          <p className="mb-2 text-sm text-muted">
            A rule-based feed is a small JSON document every client runs locally: sources, filters, weights, sort and the discovery share
            (5–30%). It's hashed and versioned onchain.
          </p>
          <div className="mb-2 flex flex-wrap gap-2">
            {Object.entries(DEFAULT_FEEDS).map(([k, d]) => (
              <button key={k} className="btn-ghost btn-sm" onClick={() => setJson(JSON.stringify(d, null, 2))}>
                Start from “{d.name}”
              </button>
            ))}
          </div>
          <textarea className="input h-72 font-mono text-xs" value={json} onChange={(e) => setJson(e.target.value)} spellCheck={false} />
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-1">Price $<input className="input w-20" value={price} onChange={(e) => setPrice(e.target.value)} /> / 30d</label>
            <label className="flex items-center gap-1">Creator share <input className="input w-16" value={share} onChange={(e) => setShare(e.target.value)} />%</label>
            <button className="btn-primary ml-auto" disabled={busy || errors.length > 0} onClick={publish}>{busy ? "Publishing…" : "Publish onchain"}</button>
          </div>
          {errors.length > 0 && <p className="mt-2 text-xs text-bad">{errors.join(" · ")}</p>}
          {err && <p className="mt-2 text-xs text-bad">{err}</p>}
        </div>
      )}

      <div className="grid gap-3 p-4 sm:grid-cols-2">
        {feeds.map((f) => (
          <div key={f.id} className="card flex flex-col p-4">
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <h3 className="flex items-center gap-1.5 font-display font-bold">{f.kind === "hosted" ? <Zap size={16} className="text-accent" /> : <LayoutGrid size={16} className="text-accent" />}{f.name}</h3>
                <p className="text-xs text-muted">by @{f.ownerHandle ?? f.ownerFid} · v{f.version} · {f.kind === "rule" ? "rule-based" : "hosted"}</p>
              </div>
              <span className={`chip ${f.priceUsd ? "bg-warn/15 text-warn" : "bg-good/15 text-good"}`}>{f.priceUsd ? `${usd(f.priceUsd)}/mo` : "free"}</span>
            </div>
            <p className="mt-2 flex-1 text-sm text-muted">{f.description}</p>
            <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted">
              <span className="chip bg-coral/12 text-coral"><Sparkles size={11} /> {pct(f.discoveryBps / 10_000)} discovery</span>
              {f.priceUsd > 0 && <span className="chip bg-panel-2">{pct(f.creatorShareBps / 10_000)} to creators</span>}
              <span className="chip bg-panel-2">{f.subscribers} paying</span>
            </div>
            <div className="mt-3 flex gap-2">
              <button
                className="btn-primary btn-sm"
                onClick={() => {
                  // topics become the selected pill; styles power "For you"
                  if (isTopicFeed(f)) localStorage.setItem(TOPIC_KEY, String(f.id));
                  else {
                    localStorage.setItem(STYLE_KEY, String(f.id));
                    localStorage.removeItem(TOPIC_KEY);
                  }
                  location.href = "/";
                }}
              >
                Use this feed
              </button>
              <button className="btn-ghost btn-sm" onClick={() => setOpen(open === f.id ? null : f.id)}>
                {open === f.id ? "Hide" : f.kind === "rule" ? "View definition" : "Details"}
              </button>
            </div>
            {open === f.id && (
              <pre className="mt-3 max-h-64 overflow-auto rounded-xl bg-bg p-3 text-[11px] text-muted">
                {f.definition ? JSON.stringify(f.definition, null, 2) : `endpoint: ${f.endpoint}\n\nHosted feeds return ranked post ids.\nPayouts never trust the feed: they use views signed by subscribers' own keys.`}
                {`\n\ndefHash: ${f.defHash}`}
              </pre>
            )}
          </div>
        ))}
      </div>
    </Shell>
  );
}
