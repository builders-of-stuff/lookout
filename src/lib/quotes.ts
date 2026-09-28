import { trackedFetch } from "./feed-log.svelte";
import type { Asset, Quote, Tick } from "./types";

// Called straight from the browser (CoinGecko sends CORS headers). Through the
// Worker it 429s: Cloudflare's shared outbound IPs exhaust the free per-IP limit.
export const COINGECKO_API = "https://api.coingecko.com/api/v3";

export type QuoteBatch = {
  quotes: Quote[];
  seeds: Record<string, Tick[]>;
  errors: string[];
};

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

function money(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v !== "string") return undefined;
  const n = Number(
    v
      .replace(/[%,$,+]/g, "")
      .replace(/,/g, "")
      .trim(),
  );
  return Number.isFinite(n) ? n : undefined;
}

async function getJson(url: string): Promise<unknown> {
  const res = await trackedFetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

function sparkToTicks(prices: number[] | undefined): Tick[] {
  if (!prices?.length) return [];
  const now = Date.now();
  const step = 60 * 60 * 1000;
  return prices.map((p, i) => ({
    t: now - (prices.length - 1 - i) * step,
    p,
  }));
}

async function fetchGecko(assets: Asset[], seed: boolean): Promise<QuoteBatch> {
  const list = assets.filter((a) => a.geckoId);
  const ids = list.map((a) => a.geckoId).join(",");
  if (!ids) return { quotes: [], seeds: {}, errors: [] };

  if (!seed) {
    const data = (await getJson(
      `${COINGECKO_API}/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true`,
    )) as Record<string, Record<string, number>>;
    const quotes: Quote[] = [];
    for (const asset of list) {
      const row = data[asset.geckoId ?? ""];
      const price = num(row?.usd);
      if (price == null) continue;
      const changePct = num(row.usd_24h_change) ?? 0;
      quotes.push({
        id: asset.id,
        price,
        changePct,
        changeAbs: price * (changePct / 100),
        marketCap: num(row.usd_market_cap),
        volume: num(row.usd_24h_vol),
        windows: { h24: changePct },
        source: "CoinGecko",
        asOf: Date.now(),
      });
    }
    return { quotes, seeds: {}, errors: [] };
  }

  const data = await getJson(
    `${COINGECKO_API}/coins/markets?vs_currency=usd&ids=${ids}&sparkline=true&price_change_percentage=1h,24h`,
  );
  if (!Array.isArray(data)) throw new Error("CoinGecko returned no markets");
  const byGecko = new Map(list.map((a) => [a.geckoId, a]));
  const quotes: Quote[] = [];
  const seeds: Record<string, Tick[]> = {};
  for (const row of data as Array<Record<string, unknown>>) {
    const asset = byGecko.get(String(row.id ?? ""));
    if (!asset) continue;
    const price = num(row.current_price);
    if (price == null) continue;
    const changePct =
      num(row.price_change_percentage_24h) ??
      num(row.price_change_percentage_24h_in_currency) ??
      0;
    const h1 = num(row.price_change_percentage_1h_in_currency);
    quotes.push({
      id: asset.id,
      price,
      changePct,
      changeAbs: price * (changePct / 100),
      marketCap: num(row.market_cap),
      volume: num(row.total_volume),
      windows: { h1, h24: changePct },
      source: "CoinGecko",
      asOf: Date.now(),
    });
    const spark = (row.sparkline_in_7d as { price?: number[] } | undefined)?.price;
    seeds[asset.id] = sparkToTicks(spark);
  }
  return { quotes, seeds, errors: [] };
}

type DexPair = {
  dexId?: string;
  pairAddress?: string;
  url?: string;
  priceUsd?: string;
  marketCap?: number;
  fdv?: number;
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  priceChange?: { m5?: number; h1?: number; h6?: number; h24?: number };
  quoteToken?: { symbol?: string };
};

function pickPair(pairs: DexPair[]): DexPair | undefined {
  return [...pairs].sort(
    (a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0),
  )[0];
}

async function fetchDex(asset: Asset, seed: boolean): Promise<QuoteBatch> {
  if (!asset.tokenAddress) return { quotes: [], seeds: {}, errors: [] };
  const data = (await getJson(`/api/dex/latest/dex/tokens/${asset.tokenAddress}`)) as {
    pairs?: DexPair[];
  };
  const pair = pickPair(data.pairs ?? []);
  const price = pair?.priceUsd != null ? Number(pair.priceUsd) : undefined;
  if (!pair || price == null || !Number.isFinite(price)) {
    throw new Error(`DexScreener had no pool for ${asset.symbol}`);
  }
  const changePct = num(pair.priceChange?.h24) ?? 0;
  const quote: Quote = {
    id: asset.id,
    price,
    changePct,
    changeAbs: price * (changePct / 100),
    marketCap: num(pair.marketCap) ?? num(pair.fdv),
    volume: num(pair.volume?.h24),
    liquidity: num(pair.liquidity?.usd),
    windows: {
      m5: num(pair.priceChange?.m5),
      h1: num(pair.priceChange?.h1),
      h6: num(pair.priceChange?.h6),
      h24: num(pair.priceChange?.h24),
    },
    source: `DexScreener · ${pair.dexId ?? "pool"}`,
    asOf: Date.now(),
    pairAddress: pair.pairAddress,
    pairUrl: pair.url,
  };
  const seeds: Record<string, Tick[]> = {};
  if (seed && asset.chain && pair.pairAddress) {
    const usdLike = new Set(["SOL", "USDC", "USDT", "USD"]);
    const candlePair =
      pickPair(
        (data.pairs ?? []).filter((p) => usdLike.has(p.quoteToken?.symbol ?? "")),
      ) ?? pair;
    const candles = await fetchPoolCandles(
      asset.chain,
      candlePair.pairAddress ?? pair.pairAddress,
      price,
    );
    if (candles.length) seeds[asset.id] = candles;
  }
  return { quotes: [quote], seeds, errors: [] };
}

async function fetchPoolCandles(
  chain: string,
  pairAddress: string,
  spot: number,
): Promise<Tick[]> {
  try {
    const data = (await getJson(
      `/api/gt/api/v2/networks/${chain}/pools/${pairAddress}/ohlcv/minute?aggregate=5&limit=200`,
    )) as {
      data?: { attributes?: { ohlcv_list?: number[][] } };
    };
    const rows = data.data?.attributes?.ohlcv_list ?? [];
    const ticks = rows
      .map((row) => ({ t: Number(row[0]) * 1000, p: Number(row[4]) }))
      .filter((t) => Number.isFinite(t.t) && Number.isFinite(t.p))
      .sort((a, b) => a.t - b.t);
    const last = ticks.at(-1)?.p;
    if (last == null || last <= 0) return [];
    if (last / spot > 8 || spot / last > 8) return [];
    return ticks;
  } catch {
    return [];
  }
}

async function fetchCnbc(assets: Asset[]): Promise<QuoteBatch> {
  const list = assets.filter((a) => a.cnbcSymbol);
  if (!list.length) return { quotes: [], seeds: {}, errors: [] };
  const symbols = list.map((a) => a.cnbcSymbol).join("|");
  const data = (await getJson(
    `/api/cnbc/quote-html-webservice/restQuote/symbolType/symbol?symbols=${encodeURIComponent(symbols)}&requestMethod=itv&noform=1&partnerId=2&output=json`,
  )) as {
    FormattedQuoteResult?: {
      FormattedQuote?: Array<Record<string, unknown>>;
    };
  };
  const rows = data.FormattedQuoteResult?.FormattedQuote ?? [];
  const bySymbol = new Map(list.map((a) => [a.cnbcSymbol, a]));
  const quotes: Quote[] = [];
  for (const row of rows) {
    const asset = bySymbol.get(String(row.symbol ?? ""));
    if (!asset) continue;
    const price = money(row.last);
    if (price == null) continue;
    const changePct = money(row.change_pct) ?? 0;
    const changeAbs = money(row.change) ?? price * (changePct / 100);
    quotes.push({
      id: asset.id,
      price,
      changePct,
      changeAbs,
      volume: money(row.volume),
      dayLow: money(row.low),
      dayHigh: money(row.high),
      source: "CNBC",
      asOf: Date.now(),
    });
  }
  if (!quotes.length) throw new Error("CNBC returned no equity quotes");
  return { quotes, seeds: {}, errors: [] };
}

async function fetchYahooSeed(asset: Asset): Promise<Tick[]> {
  if (!asset.yahooSymbol) return [];
  const symbol = encodeURIComponent(asset.yahooSymbol);
  const data = (await getJson(
    `/api/yahoo/v8/finance/chart/${symbol}?interval=5m&range=1d&includePrePost=true`,
  )) as {
    chart?: {
      result?: Array<{
        timestamp?: number[];
        indicators?: { quote?: Array<{ close?: Array<number | null> }> };
      }>;
    };
  };
  const result = data.chart?.result?.[0];
  if (!result) return [];
  const closes = result.indicators?.quote?.[0]?.close ?? [];
  const stamps = result.timestamp ?? [];
  const ticks: Tick[] = [];
  for (let i = 0; i < stamps.length; i += 1) {
    const p = closes[i];
    const t = stamps[i];
    if (p == null || t == null || !Number.isFinite(p)) continue;
    ticks.push({ t: t * 1000, p });
  }
  return ticks;
}

export async function fetchAllQuotes(
  assets: Asset[],
  seed = false,
): Promise<QuoteBatch> {
  const geckoAssets = assets.filter((a) => a.geckoId);
  const dexAssets = assets.filter((a) => a.kind === "dex");
  const equityAssets = assets.filter((a) => a.cnbcSymbol);
  const jobs: Array<Promise<QuoteBatch>> = [
    fetchGecko(geckoAssets, seed),
    ...dexAssets.map((a) => fetchDex(a, seed)),
    fetchCnbc(equityAssets),
  ];
  const settled = await Promise.allSettled(jobs);
  const quotes: Quote[] = [];
  const seeds: Record<string, Tick[]> = {};
  const errors: string[] = [];
  for (const item of settled) {
    if (item.status === "fulfilled") {
      quotes.push(...item.value.quotes);
      Object.assign(seeds, item.value.seeds);
      errors.push(...item.value.errors);
    } else {
      const reason =
        item.reason instanceof Error ? item.reason.message : "fetch failed";
      errors.push(reason);
    }
  }

  if (seed) {
    const seeded = await Promise.allSettled(
      assets
        .filter((a) => a.yahooSymbol)
        .map(async (asset) => {
          const ticks = await fetchYahooSeed(asset);
          return { id: asset.id, ticks };
        }),
    );
    for (const item of seeded) {
      if (item.status === "fulfilled" && item.value.ticks.length) {
        seeds[item.value.id] = item.value.ticks;
      }
    }
  }

  return { quotes, seeds, errors };
}
