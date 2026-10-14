"use client";
import { LayoutGrid, Users } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import type { CommunityInfo, FeedInfo, PostView, Profile } from "@monsoc/sdk";
import { Shell, PageHeader } from "@/components/Shell";
import { PostCard } from "@/components/PostCard";
import { Avatar } from "@/components/Avatar";
import { useSession, relay } from "@/lib/session";
import { isTopicFeed, STYLE_KEY, TOPIC_KEY } from "@/lib/feeds";
import { errMsg } from "@/lib/format";

type Results = { users: Profile[]; posts: PostView[]; communities: CommunityInfo[]; feeds: FeedInfo[]; tags: { tag: string; posts: number }[] };
const TABS = ["top", "people", "posts", "communities", "feeds"] as const;

export default function SearchPage() {
  return (
    <Suspense>
      <Search />
    </Suspense>
  );
}

function Search() {
  const router = useRouter();
  const params = useSearchParams();
  const { fid } = useSession();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [res, setRes] = useState<Results | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>("top");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const term = q.trim();
    if (!term) return setRes(null);
    const t = setTimeout(() => {
      router.replace(`/search?q=${encodeURIComponent(term)}`, { scroll: false });
      relay.search(term, fid ?? undefined).then(setRes, (e) => setErr(errMsg(e)));
    }, 250);
    return () => clearTimeout(t);
  }, [q, fid, router]);

  const people = (list: Profile[]) =>
    list.map((p) => (
      <Link key={p.fid} href={`/u/${p.handle ?? p.fid}`} className="flex items-center gap-3 px-4 py-3 hover:bg-panel">
        <Avatar fid={p.fid} handle={p.handle} src={p.avatar} size={40} />
        <div className="min-w-0 flex-1 text-sm">
          <div className="truncate font-semibold">{p.displayName ?? `@${p.handle}`}</div>
          <div className="truncate text-muted">@{p.handle} · {p.followers} followers</div>
          {p.bio && <div className="truncate text-muted">{p.bio}</div>}
        </div>
      </Link>
    ));
  const communities = (list: CommunityInfo[]) =>
    list.map((c) => (
      <Link key={c.id} href={`/c/${c.id}`} className="block px-4 py-3 hover:bg-panel">
        <div className="flex items-center gap-1.5 text-sm font-semibold"><Users size={14} className="text-accent" /> {c.name}</div>
        <div className="truncate text-sm text-muted">
          {[c.description, `${c.memberCount} member${c.memberCount === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}
        </div>
      </Link>
    ));
  const feeds = (list: FeedInfo[]) =>
    list.map((f) => (
      <button
        key={f.id}
        onClick={() => {
          if (isTopicFeed(f)) localStorage.setItem(TOPIC_KEY, String(f.id));
          else {
            localStorage.setItem(STYLE_KEY, String(f.id));
            localStorage.removeItem(TOPIC_KEY);
          }
          router.push("/");
        }}
        className="block w-full px-4 py-3 text-left hover:bg-panel"
      >
        <div className="flex items-center gap-1.5 text-sm font-semibold"><LayoutGrid size={14} className="text-accent" /> {f.name}</div>
        <div className="truncate text-sm text-muted">{f.description}</div>
      </button>
    ));
  const empty = res && !res.users.length && !res.posts.length && !res.communities.length && !res.feeds.length && !res.tags.length;

  return (
    <Shell>
      <PageHeader title="Search" />
      <div className="border-b border-line p-3">
        <input
          autoFocus
          className="input"
          placeholder="Search people, posts, #topics, communities, feeds"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {res && res.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {res.tags.map((t) => (
              <button key={t.tag} className="chip border border-line text-muted hover:text-text" onClick={() => setQ(`#${t.tag}`)}>
                #{t.tag} · {t.posts}
              </button>
            ))}
          </div>
        )}
      </div>
      {res && (
        <div className="flex gap-1 overflow-x-auto border-b border-line px-3 py-2">
          {TABS.map((t) => (
            <button key={t} className={`tab capitalize ${tab === t ? "tab-on" : ""}`} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </div>
      )}
      {err && <p className="p-4 text-sm text-bad">{err}</p>}
      {!q.trim() && <p className="p-8 text-center text-sm text-muted">Try a name, @handle, #topic or community.</p>}
      {empty && <p className="p-8 text-center text-sm text-muted">No results for “{q}”.</p>}
      {res && tab === "top" && (
        <>
          {res.users.length > 0 && <Section title="People">{people(res.users.slice(0, 3))}</Section>}
          {res.communities.length > 0 && <Section title="Communities">{communities(res.communities.slice(0, 3))}</Section>}
          {res.feeds.length > 0 && <Section title="Feeds">{feeds(res.feeds.slice(0, 3))}</Section>}
          {res.posts.length > 0 && <Section title="Posts">{res.posts.slice(0, 10).map((p) => <PostCard key={p.hash} post={p} />)}</Section>}
        </>
      )}
      {res && tab === "people" && people(res.users)}
      {res && tab === "posts" && res.posts.map((p) => <PostCard key={p.hash} post={p} />)}
      {res && tab === "communities" && communities(res.communities)}
      {res && tab === "feeds" && feeds(res.feeds)}
    </Shell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-line">
      <h2 className="px-4 pt-3 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h2>
      <div className="divide-y divide-line">{children}</div>
    </section>
  );
}
