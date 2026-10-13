"use client";
import { useState } from "react";
import { mediaUrl } from "@monsoc/sdk";

const hues = [262, 199, 152, 32, 340, 12, 220, 280];

/** Profile image if set (and loads), otherwise a colored initial. */
export function Avatar({ fid, handle, src, size = 40 }: { fid: number; handle?: string | null; src?: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (src && !broken)
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={mediaUrl(src, { w: size * 2, h: size * 2 })}
        alt=""
        onError={() => setBroken(true)}
        className="shrink-0 rounded-full bg-panel-2 object-cover ring-1 ring-line"
        style={{ width: size, height: size }}
      />
    );
  const h = hues[fid % hues.length]!;
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-display font-bold text-white ring-1 ring-black/5"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        background: `hsl(${h} 62% 50%)`,
      }}
    >
      {(handle ?? String(fid)).slice(0, 1).toUpperCase()}
    </div>
  );
}
