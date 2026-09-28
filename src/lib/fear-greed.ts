import type {
  FearGreedBand,
  FearGreedLeg,
  FearGreedReading,
  FearGreedState,
} from "./types";

export const BAND_LABEL: Record<FearGreedBand, string> = {
  "extreme-fear": "Extreme fear",
  fear: "Fear",
  neutral: "Neutral",
  greed: "Greed",
  "extreme-greed": "Extreme greed",
};

const CNN_LEGS: Array<{ id: string; label: string }> = [
  { id: "market_momentum_sp500", label: "Momentum" },
  { id: "stock_price_strength", label: "Strength" },
  { id: "stock_price_breadth", label: "Breadth" },
  { id: "put_call_options", label: "Options" },
  { id: "market_volatility_vix", label: "VIX" },
  { id: "junk_bond_demand", label: "Junk" },
  { id: "safe_haven_demand", label: "Haven" },
];

export function bandFromScore(score: number): FearGreedBand {
  if (score < 25) return "extreme-fear";
  if (score < 45) return "fear";
  if (score < 55) return "neutral";
  if (score < 75) return "greed";
  return "extreme-greed";
}

export function bandFromLabel(label: string, score: number): FearGreedBand {
  const n = label.trim().toLowerCase().replace(/[_-]+/g, " ");
  if (n.includes("extreme fear")) return "extreme-fear";
  if (n.includes("extreme greed")) return "extreme-greed";
  if (n === "fear" || n.endsWith(" fear")) return "fear";
  if (n === "greed" || n.endsWith(" greed")) return "greed";
  if (n === "neutral") return "neutral";
  return bandFromScore(score);
}

export function clampScore(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(100, Math.max(0, n));
}

function asTime(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric < 1e12 ? numeric * 1000 : numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

function historyScores(
  rows: unknown,
  pick: (row: unknown) => number | undefined,
): number[] {
  if (!Array.isArray(rows)) return [];
  const scores: number[] = [];
  for (const row of rows) {
    const score = pick(row);
    if (score != null) scores.push(score);
  }
  return scores.slice(-8);
}

export function parseCryptoFearGreed(payload: unknown): FearGreedReading {
  const root = payload as {
    data?: Array<Record<string, unknown>>;
    metadata?: { error?: unknown };
  };
  if (root?.metadata?.error) {
    throw new Error(String(root.metadata.error));
  }
  const rows = Array.isArray(root?.data) ? root.data : [];
  const latest = rows[0];
  const score = clampScore(latest?.value);
  if (score == null) throw new Error("Alternative.me returned no fear & greed print");
  const history = historyScores(rows, (row) =>
    clampScore((row as { value?: unknown }).value),
  ).reverse();
  const previous = history.length >= 2 ? history[history.length - 2] : undefined;
  const weekAgo = history.length >= 8 ? history[0] : undefined;
  const band = bandFromLabel(String(latest?.value_classification ?? ""), score);
  return {
    market: "crypto",
    score,
    band,
    label: BAND_LABEL[band],
    asOf: asTime(latest?.timestamp),
    previous,
    weekAgo,
    history,
    source: "Alternative.me",
    href: "https://alternative.me/crypto/fear-and-greed-index/",
  };
}

export function parseStockFearGreed(payload: unknown): FearGreedReading {
  const root = payload as Record<string, unknown> | null;
  const now = (root?.fear_and_greed ?? {}) as Record<string, unknown>;
  const score = clampScore(now.score);
  if (score == null) throw new Error("CNN returned no fear & greed print");
  const historical = (root?.fear_and_greed_historical ?? {}) as {
    data?: Array<{ x?: unknown; y?: unknown }>;
  };
  const history = historyScores(historical.data, (row) =>
    clampScore((row as { y?: unknown }).y),
  );
  const band = bandFromLabel(String(now.rating ?? ""), score);
  const legs: FearGreedLeg[] = [];
  for (const spec of CNN_LEGS) {
    const row = (root?.[spec.id] ?? {}) as Record<string, unknown>;
    const legScore = clampScore(row.score);
    if (legScore == null) continue;
    const legBand = bandFromLabel(String(row.rating ?? ""), legScore);
    legs.push({
      id: spec.id,
      label: spec.label,
      score: legScore,
      band: legBand,
    });
  }
  return {
    market: "stocks",
    score,
    band,
    label: BAND_LABEL[band],
    asOf: asTime(now.timestamp),
    previous: clampScore(now.previous_close),
    weekAgo: clampScore(now.previous_1_week),
    history: history.length ? history : [score],
    legs: legs.length ? legs : undefined,
    source: "CNN",
    href: "https://www.cnn.com/markets/fear-and-greed",
  };
}

export function assembleFearGreed(
  crypto: PromiseSettledResult<FearGreedReading>,
  stocks: PromiseSettledResult<FearGreedReading>,
): FearGreedState {
  const errors: string[] = [];
  const pick = (result: PromiseSettledResult<FearGreedReading>, label: string) => {
    if (result.status === "fulfilled") return result.value;
    errors.push(
      result.reason instanceof Error
        ? result.reason.message
        : `${label} fear & greed failed`,
    );
    return null;
  };
  const nextCrypto = pick(crypto, "Crypto");
  const nextStocks = pick(stocks, "Stock");
  return {
    crypto: nextCrypto,
    stocks: nextStocks,
    errors,
    updatedAt: nextCrypto || nextStocks ? Date.now() : null,
  };
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function fetchCryptoFearGreed(): Promise<FearGreedReading> {
  return parseCryptoFearGreed(await getJson("/api/fng/fng/?limit=8"));
}

async function fetchStockFearGreed(): Promise<FearGreedReading> {
  return parseStockFearGreed(
    await getJson("/api/cnn-fng/index/fearandgreed/graphdata"),
  );
}

export async function fetchFearGreed(): Promise<FearGreedState> {
  const [crypto, stocks] = await Promise.allSettled([
    fetchCryptoFearGreed(),
    fetchStockFearGreed(),
  ]);
  return assembleFearGreed(crypto, stocks);
}
