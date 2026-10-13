"use client";
import Link from "next/link";
import { use, useEffect, useState } from "react";
import { mediaUrl, type PostView, type Profile } from "@monsoc/sdk";
import { ProfileEditor } from "@/components/ProfileEditor";
import { useRouter } from "next/navigation";
import { Shell, PageHeader } from "@/components/Shell";
import { PostCard } from "@/components/PostCard";
import { Avatar } from "@/components/Avatar";
import { useSession, relay } from "@/lib/session";
import { errMsg, pct, timeAgo } from "@/lib/format";

type Back = { creator: number; handle: string | null; at: number; from: number | null; now: number };

export default function ProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { fid, following, setFollow, logout, refresh } = useSession();
  const [editing, setEditing] = useState(false);
  const router = useRouter();
  const [p, setP] = useState<Profile | null>(null);
  const [posts, setPosts] = useState<PostView[]>([]);
  const [backs, setBacks] = useState<Back[]>([]);
  const [tab, setTab] = useState<"posts" | "scouted">("posts");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    relay
      .user(id)
      .then(async (u) => {
        setP(u);
        const [ps, bs] = await Promise.all([relay.userPosts(u.fid), relay.backs(u.fid)]);
        setPosts(ps);
        setBacks(bs);
      })
      .catch((e) => setErr(errMsg(e)));
  }, [id]);

  if (err) return <Shell><p className="p-6 text-bad">{err}</p></Shell>;
  if (!p) return <Shell><p className="p-6 text-muted">Loading…</p></Shell>;
  const isMe = fid === p.fid;
  const isFollowing = following.has(p.fid);

  return (
    <Shell>
      <PageHeader title={p.displayName ?? `@${p.handle ?? p.fid}`} sub={`${posts.length} posts`} />
      {editing && isMe ? (
        <ProfileEditor
          profile={p}
          onCancel={() => setEditing(false)}
          onHandleChanged={(h) => {
            setEditing(false);
            router.replace(`/u/${h}`);
          }}
          onSaved={(next) => {
            setP(next);
            setEditing(false);
            refresh();
          }}
        />
      ) : (
      <div className="border-b border-line">
        <div
          className="h-32 bg-gradient-to-br from-accent-soft to-panel-2 bg-cover bg-center"
          style={p.banner ? { backgroundImage: `url("${mediaUrl(p.banner)}")` } : undefined}
        />
        <div className="px-4 pb-4">
          <div className="-mt-10 flex items-end justify-between gap-3">
            <div className="rounded-full border-4 border-bg">
              <Avatar fid={p.fid} handle={p.handle} src={p.avatar} size={80} />
            </div>
            {isMe ? (
              <div className="flex flex-wrap justify-end gap-2">
                <button className="btn-primary btn-sm" onClick={() => setEditing(true)}>Edit profile</button>
                <Link href="/wallet" className="btn-ghost btn-sm">Wallet & keys</Link>
                <button className="btn-ghost btn-sm text-bad" onClick={() => { logout(); location.href = "/"; }}>Log out</button>
              </div>
            ) : (
              fid && (
                <button
                  className={isFollowing ? "btn-ghost" : "btn-primary"}
                  onClick={() => setFollow(p.fid, !isFollowing).catch((e) => setErr(errMsg(e)))}
                >
                  {isFollowing ? "Following" : "Follow"}
                </button>
              )
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-bold">{p.displayName ?? `@${p.handle ?? p.fid}`}</h2>
            {p.scoutTier && <span className="chip bg-accent-soft text-accent">◆ {p.scoutTier} scout</span>}
          </div>
          {p.displayName && <p className="text-sm text-muted">@{p.handle ?? p.fid}</p>}
          {p.bio && <p className="mt-2 whitespace-pre-wrap break-words text-[15px]">{p.bio}</p>}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
            {p.location && <span>⌖ {p.location}</span>}
            {p.url && (
              <a href={p.url} target="_blank" rel="noreferrer nofollow" className="text-accent hover:underline">
                ↗ {p.url.replace(/^https:\/\//, "")}
              </a>
            )}
            <span>joined {timeAgo(p.createdAt)} ago</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-4 text-sm">
            <span><b>{p.followers}</b> <span className="text-muted">followers</span></span>
            <span><b>{p.verifiedFollowers}</b> <span className="text-muted">verified</span></span>
            <span><b>{p.following}</b> <span className="text-muted">following</span></span>
            <span><b>{pct(p.reputation)}</b> <span className="text-muted">reputation</span></span>
            <span><b>{(p.scoutScore / 1000).toFixed(1)}</b> <span className="text-muted">scout pts</span></span>
          </div>
          <p className="mt-3 text-[11px] text-muted">
            fid {p.fid} · custody {p.custody.slice(0, 6)}…{p.custody.slice(-4)}. Followers live on Monad; profile details are signed by this account
            and anchored, so every client shows the same profile.
          </p>
        </div>
      </div>
      )}
      <div className="flex gap-1 border-b border-line px-3 py-2">
        <button className={`tab ${tab === "posts" ? "tab-on" : ""}`} onClick={() => setTab("posts")}>Posts</button>
        <button className={`tab ${tab === "scouted" ? "tab-on" : ""}`} onClick={() => setTab("scouted")}>Scouted ({backs.length})</button>
      </div>
      {tab === "posts" && posts.map((post) => <PostCard key={post.hash} post={post} />)}
      {tab === "scouted" && (
        <div className="divide-y divide-line">
          {backs.map((b) => (
            <Link key={b.creator} href={`/u/${b.handle ?? b.creator}`} className="flex items-center gap-3 px-4 py-3 hover:bg-panel">
              <Avatar fid={b.creator} handle={b.handle} size={32} />
              <div className="flex-1 text-sm">
                <div className="font-medium">@{b.handle ?? b.creator}</div>
                <div className="text-xs text-muted">backed {timeAgo(b.at)} ago</div>
              </div>
              <div className="text-right text-sm">
                <div>
                  {b.from ?? "?"} → <b>{b.now}</b>
                </div>
                <div className="text-[11px] text-muted">verified followers</div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </Shell>
  );
}
