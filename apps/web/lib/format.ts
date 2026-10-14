export function timeAgo(ms: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/** 6-decimal USD amount to "$3.00" */
export const usd = (micro: number | bigint) => `$${(Number(micro) / 1e6).toFixed(2)}`;

export const tokenAmount = (raw: string | bigint, decimals: number) => {
  const n = Number(raw) / 10 ** decimals;
  return n >= 1 ? n.toFixed(2) : n.toPrecision(3);
};

export const pct = (x: number) => `${Math.round(x * 100)}%`;

export function errMsg(e: unknown): string {
  // viem errors carry a one-line shortMessage; the full message dumps call arguments
  const m = e instanceof Error ? ((e as { shortMessage?: string }).shortMessage ?? e.message) : String(e);
  return m.length > 160 ? m.slice(0, 160) + "…" : m;
}

export const JOIN_LABEL: Record<"open" | "token" | "invite" | "paid", string> = {
  open: "Open",
  token: "Token-gated",
  invite: "Invite-only",
  paid: "Paid",
};
