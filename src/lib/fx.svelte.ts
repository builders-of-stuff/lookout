import { trackedFetch } from "./feed-log.svelte";
import { startPoll } from "./poller";

// FX drifts slowly, and each check is one Worker request, so once a minute.
export const FX_POLL_MS = 60_000;

export const USD_CAD_URL = `/api/cnbc/quote-html-webservice/restQuote/symbolType/symbol?symbols=${encodeURIComponent("CAD=")}&requestMethod=itv&noform=1&partnerId=2&output=json`;

export type FxRate = {
  // Canadian dollars per US dollar.
  rate: number;
  change: number;
  changePct: number;
  asOf: number;
};

function decimal(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v !== "string" || !v.trim()) return undefined;
  const n = Number(v.replace(/[%,+]/g, "").trim());
  return Number.isFinite(n) ? n : undefined;
}

// CNBC stamps quotes like 2026-10-14T06:33:00.000-0400; Safari only parses
// the offset with a colon.
function stamp(v: unknown): number {
  const parsed = Date.parse(String(v ?? "").replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isFinite(parsed) ? parsed : Date.now();
}

export function parseUsdCad(payload: unknown): FxRate {
  const rows =
    (
      payload as {
        FormattedQuoteResult?: { FormattedQuote?: Array<Record<string, unknown>> };
      } | null
    )?.FormattedQuoteResult?.FormattedQuote ?? [];
  const row = rows.find((r) => r.symbol === "CAD=");
  const rate = decimal(row?.last);
  if (!row || rate == null || rate <= 0) {
    throw new Error("CNBC returned no USD/CAD rate");
  }
  const change = decimal(row.change) ?? 0;
  const previous = rate - change;
  return {
    rate,
    change,
    changePct:
      decimal(row.change_pct) ?? (previous > 0 ? (change / previous) * 100 : 0),
    asOf: stamp(row.last_time),
  };
}

export class FxMeter {
  usdCad = $state<FxRate | null>(null);
  error = $state<string | null>(null);
  stopPoll: (() => void) | null = null;

  async refresh() {
    try {
      const res = await trackedFetch(USD_CAD_URL);
      if (!res.ok) throw new Error(`USD/CAD unavailable (${res.status})`);
      this.usdCad = parseUsdCad(await res.json());
      this.error = null;
    } catch (err) {
      this.error = err instanceof Error ? err.message : "USD/CAD unavailable";
    }
  }

  start() {
    if (this.stopPoll) return;
    this.stopPoll = startPoll(() => void this.refresh(), FX_POLL_MS);
  }

  stop() {
    this.stopPoll?.();
    this.stopPoll = null;
  }
}

export const fx = new FxMeter();
