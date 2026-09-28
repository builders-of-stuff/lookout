import type { AssetKind } from "./types";

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function formatPrice(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 2 : abs >= 0.1 ? 4 : abs >= 0.01 ? 5 : 6;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: abs >= 1 ? 2 : Math.min(2, digits),
    maximumFractionDigits: digits,
  });
}

export function formatPct(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

export function formatCompact(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

export function formatTime(ts: number): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(ts));
}

export function formatClock(ts: number): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  }).format(new Date(ts));
}

export type UsSession = "pre" | "rth" | "ah" | "closed";

export function usSession(now = Date.now()): UsSession {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date(now));
  const weekday = parts.find((p) => p.type === "weekday")?.value;
  if (weekday === "Sat" || weekday === "Sun") return "closed";
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  const minute = Number(parts.find((p) => p.type === "minute")?.value);
  const m = hour * 60 + minute;
  if (m >= 4 * 60 && m < 9 * 60 + 30) return "pre";
  if (m >= 9 * 60 + 30 && m < 16 * 60) return "rth";
  if (m >= 16 * 60 && m < 20 * 60) return "ah";
  return "closed";
}

export function sessionLabel(kind: AssetKind, now = Date.now()): string {
  if (kind === "crypto") return "24h";
  if (kind === "dex") return "dex";
  const s = usSession(now);
  if (s === "rth") return "rth";
  if (s === "pre") return "pre";
  if (s === "ah") return "ah";
  return "closed";
}

export function kindLabel(kind: AssetKind): string {
  if (kind === "crypto") return "crypto";
  if (kind === "dex") return "meme";
  if (kind === "equity") return "equity";
  return "index";
}

export function shortenAddress(address: string, head = 4, tail = 4): string {
  const value = address.trim();
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function tokenFieldLabel(chain?: string): string {
  if (chain === "solana") return "Mint";
  if (chain) return "Contract";
  return "Token";
}
