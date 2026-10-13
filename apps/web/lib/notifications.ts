"use client";
import { useEffect, useState } from "react";
import { relay } from "./session";

const KEY = (fid: number) => `monsoc.notifSeen.${fid}`;
const EVENT = "monsoc:notif-seen";

export function markNotificationsSeen(fid: number) {
  localStorage.setItem(KEY(fid), String(Date.now()));
  window.dispatchEvent(new Event(EVENT));
}

/** Unread count since the last visit to /notifications; refreshes on new relay messages and every 30s. */
export function useUnreadCount(fid: number | null): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!fid) return setCount(0);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const check = () => {
      const since = Number(localStorage.getItem(KEY(fid)) ?? 0);
      relay.unreadCount(fid, since).then((r) => setCount(r.count), () => undefined);
    };
    check();
    const poll = setInterval(check, 30_000);
    const stop = relay.stream(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(check, 1500);
    });
    window.addEventListener(EVENT, check);
    return () => {
      clearInterval(poll);
      stop();
      if (timer) clearTimeout(timer);
      window.removeEventListener(EVENT, check);
    };
  }, [fid]);
  return count;
}
