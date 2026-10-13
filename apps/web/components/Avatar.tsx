const hues = [262, 199, 152, 32, 340, 12, 220, 280];

export function Avatar({ fid, handle, size = 40 }: { fid: number; handle?: string | null; size?: number }) {
  const h = hues[fid % hues.length]!;
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        background: `linear-gradient(135deg, hsl(${h} 70% 55%), hsl(${(h + 40) % 360} 70% 40%))`,
      }}
    >
      {(handle ?? String(fid)).slice(0, 1).toUpperCase()}
    </div>
  );
}
