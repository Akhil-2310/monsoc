"use client";
import { Search, TrendingUp } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Profile } from "@monsoc/sdk";
import { useSession, relay } from "@/lib/session";
import { errMsg } from "@/lib/format";
import { Avatar } from "./Avatar";
import { CreateMarketSheet } from "./CreateMarketSheet";

/** Opens the market sheet for any creator, after checking they've opted in. Shared by post menus and /markets. */
export function useMarketLauncher() {
  const { fid } = useSession();
  const [target, setTarget] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const launch = async (creatorFid: number) => {
    setError(null);
    if (creatorFid === fid) return setError("You can't open a market on yourself.");
    setBusy(true);
    try {
      const [info, p] = await Promise.all([relay.marketInfo(creatorFid), relay.user(creatorFid)]);
      if (!info.enabled) setError("Markets aren't enabled on this network.");
      else if (!info.optedIn) setError(`@${p.handle ?? creatorFid} hasn't allowed markets on themselves yet.`);
      else setTarget(p);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  // portal to <body> so a post card's stacking/clipping can't trap the full-screen sheet
  const sheet =
    target &&
    createPortal(
      <CreateMarketSheet
        creatorFid={target.fid}
        handle={target.handle ?? String(target.fid)}
        followers={target.followers}
        onClose={() => setTarget(null)}
      />,
      document.body,
    );
  return { launch, error, busy, sheet, clearError: () => setError(null) };
}

/** "+ New market" on /markets: search for a creator, then open the usual sheet. */
export function NewMarketPicker({ onClose }: { onClose: () => void }) {
  const { fid } = useSession();
  const [q, setQ] = useState("");
  const [users, setUsers] = useState<Profile[]>([]);
  const [optedIn, setOptedIn] = useState<Record<number, boolean>>({});
  const { launch, error, busy, sheet } = useMarketLauncher();

  useEffect(() => {
    const term = q.trim().replace(/^@/, "");
    if (!term) return setUsers([]);
    const t = setTimeout(() => {
      relay.search(term, fid ?? undefined).then(
        (r) => {
          const list = r.users.filter((u) => u.fid !== fid).slice(0, 8);
          setUsers(list);
          // show who accepts markets before anyone clicks
          for (const u of list)
            relay.marketInfo(u.fid).then((i) => setOptedIn((s) => ({ ...s, [u.fid]: i.optedIn })), () => undefined);
        },
        () => setUsers([]),
      );
    }, 250);
    return () => clearTimeout(t);
  }, [q, fid]);

  if (sheet) return sheet;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center" onClick={onClose}>
      <div className="card w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-bold"><TrendingUp size={18} className="text-accent" /> New market</h3>
          <button className="text-muted hover:text-text" onClick={onClose}>✕</button>
        </div>
        <p className="mt-1 text-sm text-muted">Pick a creator who allows markets, then set a follower milestone.</p>
        <div className="field mt-4">
          <Search size={15} className="text-muted" />
          <input
            autoFocus
            className="w-full bg-transparent py-2 text-sm outline-none placeholder:text-muted"
            placeholder="Search creators by handle or name"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <ul className="mt-3 max-h-80 space-y-1 overflow-y-auto">
          {users.map((u) => {
            const ok = optedIn[u.fid];
            return (
              <li key={u.fid}>
                <button
                  disabled={busy || ok === false}
                  onClick={() => launch(u.fid)}
                  className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-panel-2 disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:bg-transparent"
                >
                  <Avatar fid={u.fid} handle={u.handle} src={u.avatar} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{u.displayName || `@${u.handle}`}</span>
                    <span className="block truncate text-xs text-muted">@{u.handle} · {u.followers} followers</span>
                  </span>
                  {ok === true && <span className="chip bg-accent-soft text-accent">Open market</span>}
                  {ok === false && <span className="chip bg-panel-2 text-muted">Not opted in</span>}
                </button>
              </li>
            );
          })}
          {q.trim() && users.length === 0 && <li className="px-2 py-6 text-center text-sm text-muted">No creators found.</li>}
        </ul>
        {error && <p className="mt-2 text-xs text-bad">{error}</p>}
      </div>
    </div>
  );
}
