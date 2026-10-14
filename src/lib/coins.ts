import { trackedFetch } from "./feed-log.svelte";
import { pacer, type PacerOptions } from "./poller";
import type { QuoteBatch } from "./quotes";
import type { Asset, Quote, Tick } from "./types";

// A coin's price comes from the first feed that answers, in this order:
// Binance, Coinbase, Kraken, CoinGecko, CoinPaprika. All are keyless and send
// CORS headers, so the browser calls them directly. The exchanges are live but
// only know their own listings and trading, so CoinGecko, or CoinPaprika when
// CoinGecko fails, also supplies market cap and market-wide volume.

// Through the Worker CoinGecko 429s: Cloudflare's shared outbound IPs exhaust
// its free per-IP limit.
export const COINGECKO_API = "https://api.coingecko.com/api/v3";
export const PAPRIKA_API = "https://api.coinpaprika.com/v1";
const BINANCE_API = "https://data-api.binance.vision/api/v3";
const COINBASE_API = "https://api.exchange.coinbase.com";
const KRAKEN_API = "https://api.kraken.com/0/public";

const HOUR_MS = 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * HOUR_MS;

// Symbols an exchange could list; anything else skips straight to CoinGecko.
const TICKER = /^[A-Z0-9]{2,12}$/;

type Priced = { quote: Quote; ticks: Tick[] };

type Venue = {
  name: string;
  price(asset: Asset, seed: boolean): Promise<Priced>;
};

function keyedPacer(options: PacerOptions) {
  const paces = new Map<string, ReturnType<typeof pacer>>();
  return (key: string) => {
    let pace = paces.get(key);
    if (!pace) paces.set(key, (pace = pacer(options)));
    return pace;
  };
}

// Per exchange and coin. A coin an exchange does not list gets a refusal
// without CORS headers, which looks like any outage, so it only holds back
// that one pair.
const exchangePace = keyedPacer({ everyMs: 0, retryMs: 60_000, maxMs: 16 * 60_000 });
// The keyless API refreshes once a minute and limits calls per IP, counting
// refused ones. Past the limit it blocks with a 403 that has no CORS headers,
// which the browser reports as a CORS error.
const geckoPace = pacer({ everyMs: 60_000, retryMs: 2 * 60_000, maxMs: 16 * 60_000 });
// Keyless CoinPaprika allows 20,000 calls a month and its data trails by a few
// minutes, so it is asked rarely, per coin.
const paprikaPace = keyedPacer({
  everyMs: 5 * 60_000,
  retryMs: 5 * 60_000,
  maxMs: 30 * 60_000,
});

// Asset ids CoinGecko priced on its last successful call.
const geckoHas = new Set<string>();
// From the latest market cap, so the cap follows the live price in between.
const supplyOf = new Map<string, number>();
// Market-wide 24h volume, not just one exchange's.
const volumeOf = new Map<string, number>();

const toNum = (v: unknown): number | undefined => {
  const n = typeof v === "string" && v.trim() ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
};

async function getJson(url: string): Promise<unknown> {
  const res = await trackedFetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

function quoteOf(
  asset: Asset,
  source: string,
  price: number,
  changePct: number,
  volume?: number,
): Quote {
  return {
    id: asset.id,
    price,
    changePct,
    changeAbs: price * (changePct / 100),
    volume,
    windows: { h24: changePct },
    source,
    asOf: Date.now(),
  };
}

// For exchanges, which give the price 24 hours ago rather than a change.
function quoteSince(
  asset: Asset,
  source: string,
  price: number,
  open: number,
  volume?: number,
): Quote {
  return {
    ...quoteOf(asset, source, price, (price / open - 1) * 100, volume),
    changeAbs: price - open,
  };
}

// Hourly candles, oldest first, trimmed to the last week. `scale` turns
// seconds into milliseconds.
function candleTicks(rows: unknown, timeAt: number, closeAt: number, scale = 1) {
  if (!Array.isArray(rows)) return [];
  const from = Date.now() - WEEK_MS;
  const ticks: Tick[] = [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const t = toNum(row[timeAt]);
    const p = toNum(row[closeAt]);
    if (t != null && p != null && p > 0 && t * scale >= from) {
      ticks.push({ t: t * scale, p });
    }
  }
  return ticks.sort((a, b) => a.t - b.t);
}

function sparkToTicks(prices: number[] | undefined): Tick[] {
  if (!prices?.length) return [];
  const now = Date.now();
  return prices.map((p, i) => ({ t: now - (prices.length - 1 - i) * HOUR_MS, p }));
}

// A failed chart seed never costs the quote; the chart fills in from polls.
const candles = (seed: boolean, url: string) =>
  seed ? getJson(url).catch(() => []) : Promise.resolve([]);

const binance: Venue = {
  name: "Binance",
  async price(asset, seed) {
    const symbol = `${asset.symbol}USDT`;
    const [row, klines] = await Promise.all([
      getJson(`${BINANCE_API}/ticker/24hr?symbol=${symbol}&type=MINI`) as Promise<
        Record<string, unknown>
      >,
      candles(seed, `${BINANCE_API}/klines?symbol=${symbol}&interval=1h&limit=168`),
    ]);
    const price = toNum(row.lastPrice);
    const open = toNum(row.openPrice);
    if (price == null || !open) throw new Error(`Binance had no ${symbol}`);
    return {
      quote: quoteSince(asset, "Binance", price, open, toNum(row.quoteVolume)),
      ticks: candleTicks(klines, 0, 4),
    };
  },
};

const coinbase: Venue = {
  name: "Coinbase",
  async price(asset, seed) {
    const product = `${COINBASE_API}/products/${asset.symbol}-USD`;
    const [stats, rows] = await Promise.all([
      getJson(`${product}/stats`) as Promise<Record<string, unknown>>,
      candles(seed, `${product}/candles?granularity=3600`),
    ]);
    const price = toNum(stats.last);
    const open = toNum(stats.open);
    if (price == null || !open) throw new Error(`Coinbase had no ${asset.symbol}-USD`);
    // Volume comes in coins.
    const volume = toNum(stats.volume);
    return {
      quote: quoteSince(asset, "Coinbase", price, open, volume && volume * price),
      ticks: candleTicks(rows, 0, 4, 1000),
    };
  },
};

const kraken: Venue = {
  name: "Kraken",
  // One call for hourly candles gives the price, the 24h change, and the chart.
  async price(asset, seed) {
    const since = Math.floor((Date.now() - (seed ? WEEK_MS : 25 * HOUR_MS)) / 1000);
    const data = (await getJson(
      `${KRAKEN_API}/OHLC?pair=${asset.symbol}USD&interval=60&since=${since}`,
    )) as { error?: string[]; result?: Record<string, unknown> };
    if (data.error?.length) throw new Error(`Kraken: ${data.error.join(", ")}`);
    const key = Object.keys(data.result ?? {}).find((k) => k !== "last");
    // [time, open, high, low, close, vwap, volume, count], oldest first. The
    // last row is the hour in progress.
    const rows = (key ? data.result?.[key] : []) as unknown[][];
    const price = toNum(rows.at(-1)?.[4]);
    const open = toNum((rows.at(-25) ?? rows[0])?.[1]);
    if (price == null || !open) throw new Error(`Kraken had no ${asset.symbol}USD`);
    let volume = 0;
    for (const row of rows.slice(-24))
      volume += (toNum(row[5]) ?? 0) * (toNum(row[6]) ?? 0);
    return {
      quote: quoteSince(asset, "Kraken", price, open, volume || undefined),
      ticks: seed ? candleTicks(rows, 0, 4, 1000) : [],
    };
  },
};

const EXCHANGES = [binance, coinbase, kraken];

async function coingecko(coins: Asset[], seed: boolean): Promise<Map<string, Priced>> {
  const ids = coins.map((a) => a.geckoId).join(",");
  const priced = new Map<string, Priced>();
  if (!seed) {
    const data = (await getJson(
      `${COINGECKO_API}/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true`,
    )) as Record<string, Record<string, unknown>>;
    for (const asset of coins) {
      const row = data[asset.geckoId ?? ""];
      const price = toNum(row?.usd);
      if (price == null) continue;
      const changePct = toNum(row.usd_24h_change) ?? 0;
      const quote = quoteOf(
        asset,
        "CoinGecko",
        price,
        changePct,
        toNum(row.usd_24h_vol),
      );
      quote.marketCap = toNum(row.usd_market_cap);
      priced.set(asset.id, { quote, ticks: [] });
    }
    return priced;
  }

  const data = await getJson(
    `${COINGECKO_API}/coins/markets?vs_currency=usd&ids=${ids}&sparkline=true`,
  );
  if (!Array.isArray(data)) throw new Error("CoinGecko returned no markets");
  const byGecko = new Map(coins.map((a) => [a.geckoId, a]));
  for (const row of data as Array<Record<string, unknown>>) {
    const asset = byGecko.get(String(row.id ?? ""));
    const price = toNum(row.current_price);
    if (!asset || price == null) continue;
    const changePct = toNum(row.price_change_percentage_24h) ?? 0;
    const quote = quoteOf(
      asset,
      "CoinGecko",
      price,
      changePct,
      toNum(row.total_volume),
    );
    quote.marketCap = toNum(row.market_cap);
    const spark = (row.sparkline_in_7d as { price?: number[] } | undefined)?.price;
    priced.set(asset.id, { quote, ticks: sparkToTicks(spark) });
  }
  return priced;
}

// CoinPaprika ids read like "btc-bitcoin"; guess one for coins found elsewhere.
function paprikaId(asset: Asset) {
  if (asset.paprikaId) return asset.paprikaId;
  return `${asset.symbol}-${asset.name}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function paprika(asset: Asset): Promise<Priced> {
  const data = (await getJson(`${PAPRIKA_API}/tickers/${paprikaId(asset)}`)) as {
    quotes?: { USD?: Record<string, unknown> };
  };
  const usd = data.quotes?.USD;
  const price = toNum(usd?.price);
  if (!usd || price == null) throw new Error(`CoinPaprika had no ${asset.symbol}`);
  const changePct = toNum(usd.percent_change_24h) ?? 0;
  const quote = quoteOf(asset, "CoinPaprika", price, changePct, toNum(usd.volume_24h));
  quote.marketCap = toNum(usd.market_cap);
  return { quote, ticks: [] };
}

async function fromExchanges(coins: Asset[], seed: boolean) {
  const priced = new Map<string, Priced>();
  await Promise.all(
    coins
      .filter((asset) => TICKER.test(asset.symbol))
      .map(async (asset) => {
        for (const venue of EXCHANGES) {
          const pace = exchangePace(`${venue.name}:${asset.symbol}`);
          if (!pace.due()) continue;
          try {
            priced.set(asset.id, await venue.price(asset, seed));
            pace.succeeded();
            return;
          } catch {
            pace.failed();
          }
        }
      }),
  );
  return priced;
}

async function fromGecko(coins: Asset[], seed: boolean) {
  const listed = coins.filter((a) => a.geckoId);
  // A newly added coin does not wait out the minute.
  const due = geckoPace.due() || (seed && !geckoPace.failing);
  if (!listed.length || !due) return new Map<string, Priced>();
  try {
    const priced = await coingecko(listed, seed);
    geckoPace.succeeded();
    for (const asset of listed) {
      if (priced.has(asset.id)) geckoHas.add(asset.id);
      else geckoHas.delete(asset.id);
    }
    return priced;
  } catch {
    geckoPace.failed();
    return new Map<string, Priced>();
  }
}

async function fromPaprika(coins: Asset[]) {
  const priced = new Map<string, Priced>();
  await Promise.all(
    coins.map(async (asset) => {
      const pace = paprikaPace(asset.id);
      if (!pace.due()) return;
      try {
        priced.set(asset.id, await paprika(asset));
        pace.succeeded();
      } catch {
        pace.failed();
      }
    }),
  );
  return priced;
}

export async function fetchCoins(assets: Asset[], seed: boolean): Promise<QuoteBatch> {
  const coins = assets.filter((a) => a.kind === "crypto");
  if (!coins.length) return { quotes: [], seeds: {}, errors: [] };

  const [live, gecko] = await Promise.all([
    fromExchanges(coins, seed),
    fromGecko(coins, seed),
  ]);
  const viaGecko = (asset: Asset) => !geckoPace.failing && geckoHas.has(asset.id);
  const market = new Map([
    ...gecko,
    ...(await fromPaprika(coins.filter((a) => !viaGecko(a)))),
  ]);
  for (const [id, { quote }] of market) {
    if (quote.marketCap) supplyOf.set(id, quote.marketCap / quote.price);
    if (quote.volume != null) volumeOf.set(id, quote.volume);
  }

  const quotes: Quote[] = [];
  const seeds: Record<string, Tick[]> = {};
  const errors: string[] = [];
  for (const asset of coins) {
    const hit = live.get(asset.id) ?? market.get(asset.id);
    if (!hit) {
      // Quiet while a feed that last answered is only waiting its turn.
      const waiting =
        (viaGecko(asset) && geckoPace.resting()) || paprikaPace(asset.id).resting();
      if (!waiting) errors.push(`${asset.symbol}: every price feed failed`);
      continue;
    }
    const supply = supplyOf.get(asset.id);
    quotes.push({
      ...hit.quote,
      marketCap: supply != null ? supply * hit.quote.price : undefined,
      volume: volumeOf.get(asset.id) ?? hit.quote.volume,
    });
    const ticks = hit.ticks.length ? hit.ticks : (market.get(asset.id)?.ticks ?? []);
    if (ticks.length) seeds[asset.id] = ticks;
  }
  return { quotes, seeds, errors };
}
