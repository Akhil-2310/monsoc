"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Notification } from "@monsoc/sdk";
import { Shell, PageHeader } from "@/components/Shell";
import { Avatar } from "@/components/Avatar";
import { useSession, relay } from "@/lib/session";
import { markNotificationsSeen } from "@/lib/notifications";
import { errMsg, timeAgo } from "@/lib/format";

const VERB: Record<Notification["kind"], string> = {
  like: "liked your post",
  repost: "reposted your post",
  reply: "replied to you",
  mention: "mentioned you",
  follow: "followed you",
  back: "backed you as a scout",
  invite: "invited you to",
};
const ICON: Record<Notification["kind"], string> = { like: "♥", repost: "⟲", reply: "↩", mention: "@", follow: "+", back: "◆", invite: "◍" };

export default function Notifications() {
  const { fid, ready } = useSession();
  const [items, setItems] = useState<Notification[] | null>(null);
  const [more, setMore] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!fid) return;
    try {
      const n = await relay.notifications(fid);
      setItems(n);
      setMore(n.length === 50);
      markNotificationsSeen(fid);
    } catch (e) {
      setErr(errMsg(e));
    }
  }, [fid]);
  useEffect(() => {
    load();
  }, [load]);

  const loadMore = async () => {
    if (!fid || !items?.length) return;
    const n = await relay.notifications(fid, items[items.length - 1]!.at);
    setItems([...items, ...n]);
    setMore(n.length === 50);
  };

  if (ready && !fid)
    return (
      <Shell>
        <PageHeader title="Notifications" />
        <p className="p-6 text-sm text-muted"><Link href="/login" className="text-accent">Log in</Link> to see notifications.</p>
      </Shell>
    );

  return (
    <Shell>
      <PageHeader title="Notifications" right={<button className="btn-ghost btn-sm" onClick={load}>Refresh</button>} />
      {err && <p className="p-4 text-sm text-bad">{err}</p>}
      {items?.length === 0 && <p className="p-8 text-center text-sm text-muted">Nothing yet. Likes, replies, mentions and new followers show up here.</p>}
      <div className="divide-y divide-line">
        {items?.map((n) => {
          const who = n.actor.displayName ?? `@${n.actor.handle ?? n.actor.fid}`;
          const href = n.kind === "invite" && n.community ? `/c/${n.community.id}` : n.post ? `/post/${n.post.hash}` : `/u/${n.actor.handle ?? n.actor.fid}`;
          return (
            <Link key={n.id} href={href} className="flex gap-3 px-4 py-3 hover:bg-panel">
              <span className="w-5 pt-2 text-center text-muted">{ICON[n.kind]}</span>
              <Avatar fid={n.actor.fid} handle={n.actor.handle} src={n.actor.avatar} size={36} />
              <div className="min-w-0 flex-1 text-sm">
                <p>
                  <b>{who}</b> {VERB[n.kind]} {n.kind === "invite" && n.community ? <b>{n.community.name}</b> : null}
                  <span className="text-muted"> · {timeAgo(n.at)}</span>
                </p>
                {n.post?.text && <p className="mt-0.5 line-clamp-2 text-muted">{n.post.text}</p>}
              </div>
            </Link>
          );
        })}
      </div>
      {more && items && items.length > 0 && (
        <div className="p-4 text-center">
          <button className="btn-ghost btn-sm" onClick={loadMore}>Load more</button>
        </div>
      )}
    </Shell>
  );
}
