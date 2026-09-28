import { DEFAULT_ASSETS, STORAGE_KEY, TICK_CAP } from "./assets";
import type { AlertEvent, AlertRule, Asset, DeskState, Quote, Tick } from "./types";
import { composeWatchlist, findOnDesk } from "./watchlist";

const empty = (): DeskState => ({
  quotes: {},
  ticks: {},
  rules: [],
  events: [],
  focusId: DEFAULT_ASSETS[0]?.id ?? "btc",
  assets: [...DEFAULT_ASSETS],
});

function isAsset(value: unknown): value is Asset {
  if (!value || typeof value !== "object") return false;
  const asset = value as Asset;
  return (
    typeof asset.id === "string" &&
    asset.id.length > 0 &&
    typeof asset.symbol === "string" &&
    typeof asset.name === "string" &&
    ["crypto", "dex", "equity", "index"].includes(asset.kind) &&
    Array.isArray(asset.links) &&
    asset.links.every(
      (link) => link && typeof link.label === "string" && typeof link.href === "string",
    )
  );
}

function assetList(value: unknown[]): Asset[] {
  const assets: Asset[] = [];
  for (const asset of value) {
    if (isAsset(asset) && !findOnDesk(asset, assets)) assets.push(asset);
  }
  return assets;
}

const ids = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((id): id is string => typeof id === "string")
    : [];

export function loadDesk(): DeskState {
  try {
    if (typeof localStorage === "undefined") return empty();
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as Partial<DeskState> & {
      customAssets?: unknown;
      hiddenIds?: unknown;
      order?: unknown;
    };
    if (!parsed || typeof parsed !== "object") return empty();
    // An explicitly saved empty list is intentional, too. Never merge defaults
    // into the current format; only use them to migrate the original format.
    const assets = Array.isArray(parsed.assets)
      ? assetList(parsed.assets)
      : composeWatchlist(
          Array.isArray(parsed.customAssets) ? assetList(parsed.customAssets) : [],
          ids(parsed.hiddenIds),
          ids(parsed.order),
        );
    return {
      quotes: parsed.quotes ?? {},
      ticks: parsed.ticks ?? {},
      rules: parsed.rules ?? [],
      events: (parsed.events ?? []).slice(0, 80),
      focusId: assets.some((asset) => asset.id === parsed.focusId)
        ? parsed.focusId!
        : (assets[0]?.id ?? ""),
      assets,
    };
  } catch {
    return empty();
  }
}

export function saveDesk(state: DeskState): boolean {
  try {
    const slim: DeskState = {
      ...state,
      ticks: Object.fromEntries(
        Object.entries(state.ticks).map(([id, ticks]) => [id, ticks.slice(-TICK_CAP)]),
      ),
      events: state.events.slice(0, 80),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(slim));
    return true;
  } catch {
    // If cached history fills the quota, prioritize the user's watchlist and
    // alerts. Quotes and ticks can be fetched again on the next visit.
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          ...state,
          quotes: {},
          ticks: {},
          events: [],
        }),
      );
      return true;
    } catch {
      return false;
    }
  }
}

export function mergeTicks(existing: Tick[] = [], incoming: Tick[] = []): Tick[] {
  const map = new Map<number, number>();
  for (const tick of [...incoming, ...existing]) {
    if (!Number.isFinite(tick.p) || !Number.isFinite(tick.t)) continue;
    const sec = Math.floor(tick.t / 1000) * 1000;
    map.set(sec, tick.p);
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, p]) => ({ t, p }))
    .slice(-TICK_CAP);
}

export function appendQuoteTick(ticks: Tick[], quote: Quote): Tick[] {
  const last = ticks.at(-1);
  if (last && last.p === quote.price && quote.asOf - last.t < 60_000) return ticks;
  return mergeTicks(ticks, [{ t: quote.asOf, p: quote.price }]);
}

export function uid(): string {
  return crypto.randomUUID();
}

export type { AlertEvent, AlertRule, Quote, Tick };
