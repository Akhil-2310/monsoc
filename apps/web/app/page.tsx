"use client";
import { useSession } from "@/lib/session";
import { HomeFeed } from "@/components/HomeFeed";
import { Landing } from "@/components/Landing";
import { Logo } from "@/components/Shell";

/** Signed in: your feed. Signed out: the landing page (the feed is still browsable at /explore). */
export default function Home() {
  const { fid, ready } = useSession();
  if (!ready)
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-pulse">
          <Logo size={48} />
        </div>
      </div>
    );
  return fid ? <HomeFeed /> : <Landing />;
}
