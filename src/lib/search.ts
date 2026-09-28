import { DEFAULT_ASSETS, tv } from "./assets";
import { trackedFetch } from "./feed-log.svelte";
import { COINGECKO_API } from "./quotes";
import type { Asset } from "./types";

export type SearchGroup = "coin" | "dex" | "stock";

export type SearchHit = {
  key: string;
  group: SearchGroup;
  asset: Asset;
  detail: string;
};

const CNBC_INDEX: Record<string, string> = {
  "^GSPC": ".SPX",
  "^DJI": ".DJI",
  "^IXIC": ".IXIC",
  "^RUT": ".RUT",
  "^VIX": ".VIX",
};

const TV_INDEX: Record<string, string> = {
  "^GSPC": "FOREXCOM:SPXUSD",
  "^DJI": "DJ:DJI",
  "^IXIC": "NASDAQ:IXIC",
  "^RUT": "CBOE:RUT",
  "^VIX": "CBOE:VIX",
};

const TV_EXCHANGE: Record<string, string> = {
  NASDAQ: "NASDAQ",
  NYSE: "NYSE",
  AMEX: "AMEX",
  NYSEARCA: "AMEX",
  NYSEAMERICAN: "AMEX",
  OTC: "OTC",
};

async function getJson(url: string): Promise<unknown> {
  const res = await trackedFetch(url);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

function geckoHit(row: Record<string, unknown>): SearchHit | null {
  const id = String(row.id ?? "");
  const symbol = String(row.symbol ?? "").toUpperCase();
  const name = String(row.name ?? symbol);
  if (!id || !symbol) return null;
  const tvSymbol = `BINANCE:${symbol}USDT`;
  const asset: Asset = {
    id: `gecko:${id}`,
    symbol,
    name,
    kind: "crypto",
    geckoId: id,
    tradingView: tvSymbol,
    links: [
      { label: "TradingView", href: tv(tvSymbol) },
      { label: "CMC", href: `https://coinmarketcap.com/currencies/${id}/` },
      { label: "DexScreener", href: `https://dexscreener.com/search?q=${symbol}` },
    ],
  };
  const rank = row.market_cap_rank;
  return {
    key: asset.id,
    group: "coin",
    asset,
    detail: typeof rank === "number" ? `mcap #${rank}` : "CoinGecko",
  };
}

function dexHit(row: Record<string, unknown>): SearchHit | null {
  const chain = String(row.chainId ?? "");
  const base = (row.baseToken ?? {}) as Record<string, unknown>;
  const address = String(base.address ?? "");
  const symbol = String(base.symbol ?? "").toUpperCase();
  const name = String(base.name ?? symbol);
  if (!chain || !address || !symbol) return null;
  const url =
    typeof row.url === "string"
      ? row.url
      : `https://dexscreener.com/${chain}/${address}`;
  const asset: Asset = {
    id: `dex:${chain}:${address}`,
    symbol,
    name,
    kind: "dex",
    chain,
    tokenAddress: address,
    dexEmbed: chain,
    links: [
      { label: "DexScreener", href: url },
      ...(chain === "solana"
        ? [{ label: "Solscan", href: `https://solscan.io/token/${address}` }]
        : []),
    ],
  };
  const liq = (row.liquidity as { usd?: number } | undefined)?.usd;
  const quote = (row.quoteToken as { symbol?: string } | undefined)?.symbol;
  const detail = [chain, quote ? `vs ${quote}` : "", liq ? `liq` : ""]
    .filter(Boolean)
    .join(" · ");
  return { key: asset.id.toLowerCase(), group: "dex", asset, detail };
}

function stockHit(row: Record<string, unknown>): SearchHit | null {
  const symbol = String(row.symbol ?? "");
  const quoteType = String(row.quoteType ?? "");
  if (!symbol) return null;
  if (["OPTION", "FUTURE", "CRYPTOCURRENCY", "CURRENCY"].includes(quoteType)) {
    return null;
  }
  const name = String(row.shortname ?? row.longname ?? symbol);
  const exch = String(row.exchDisp ?? row.exchange ?? "");
  const isIndex = quoteType === "INDEX";
  const cnbc = CNBC_INDEX[symbol] ?? symbol.replaceAll("-", ".");
  const tvSymbol =
    TV_INDEX[symbol] ??
    `${TV_EXCHANGE[exch.toUpperCase()] ?? (isIndex ? "SP" : "NASDAQ")}:${symbol.replace(/^\^/, "")}`;
  const asset: Asset = {
    id: `stock:${symbol}`,
    symbol: symbol.replace(/^\^/, ""),
    name,
    kind: isIndex ? "index" : "equity",
    yahooSymbol: symbol,
    cnbcSymbol: cnbc,
    tradingView: tvSymbol,
    links: [
      { label: "TradingView", href: tv(tvSymbol) },
      {
        label: "Yahoo",
        href: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`,
      },
    ],
  };
  const kind = quoteType === "ETF" ? "ETF" : isIndex ? "index" : "equity";
  return {
    key: asset.id,
    group: "stock",
    asset,
    detail: [exch, kind].filter(Boolean).join(" · "),
  };
}

function tickerFallback(raw: string): SearchHit {
  const symbol = raw.toUpperCase();
  const tvSymbol = `NASDAQ:${symbol}`;
  const asset: Asset = {
    id: `stock:${symbol}`,
    symbol,
    name: symbol,
    kind: "equity",
    yahooSymbol: symbol,
    cnbcSymbol: symbol.replaceAll("-", "."),
    tradingView: tvSymbol,
    links: [
      { label: "TradingView", href: tv(tvSymbol) },
      { label: "Yahoo", href: `https://finance.yahoo.com/quote/${symbol}` },
    ],
  };
  return {
    key: asset.id,
    group: "stock",
    asset,
    detail: "ticker · try as equity",
  };
}

async function searchCoins(query: string): Promise<SearchHit[]> {
  const data = (await getJson(
    `${COINGECKO_API}/search?query=${encodeURIComponent(query)}`,
  )) as { coins?: Array<Record<string, unknown>> };
  return (data.coins ?? [])
    .slice(0, 6)
    .map(geckoHit)
    .filter((h): h is SearchHit => h !== null);
}

async function searchDex(query: string): Promise<SearchHit[]> {
  const data = (await getJson(
    `/api/dex/latest/dex/search?q=${encodeURIComponent(query)}`,
  )) as { pairs?: Array<Record<string, unknown>> };
  const seen = new Set<string>();
  const hits: SearchHit[] = [];
  const ranked = [...(data.pairs ?? [])].sort(
    (a, b) =>
      ((b.liquidity as { usd?: number } | undefined)?.usd ?? 0) -
      ((a.liquidity as { usd?: number } | undefined)?.usd ?? 0),
  );
  for (const row of ranked) {
    const hit = dexHit(row);
    if (!hit || seen.has(hit.key)) continue;
    seen.add(hit.key);
    hits.push(hit);
    if (hits.length >= 6) break;
  }
  return hits;
}

async function searchStocks(query: string): Promise<SearchHit[]> {
  const data = (await getJson(
    `/api/yahoo/v1/finance/search?q=${encodeURIComponent(query)}`,
  )) as { quotes?: Array<Record<string, unknown>> };
  const hits: SearchHit[] = [];
  for (const row of data.quotes ?? []) {
    const hit = stockHit(row);
    if (!hit) continue;
    hits.push(hit);
    if (hits.length >= 6) break;
  }
  return hits;
}

async function confirmTicker(query: string): Promise<SearchHit[]> {
  if (!/^[A-Za-z.]{1,8}$/.test(query)) return [];
  const symbol = query.toUpperCase();
  const data = (await getJson(
    `/api/cnbc/quote-html-webservice/restQuote/symbolType/symbol?symbols=${encodeURIComponent(symbol)}&requestMethod=itv&noform=1&partnerId=2&output=json`,
  )) as {
    FormattedQuoteResult?: {
      FormattedQuote?: Array<Record<string, unknown>>;
    };
  };
  const row = data.FormattedQuoteResult?.FormattedQuote?.[0];
  if (!row || row.code === 1 || row.last == null || row.last === "N/A") return [];
  const name = String(row.name ?? row.shortName ?? symbol);
  const type = String(row.type ?? "STOCK").toUpperCase();
  const exch = String(row.exchange ?? "");
  const isIndex = type.includes("INDEX");
  const tvSymbol = `${TV_EXCHANGE[exch.toUpperCase()] ?? (isIndex ? "SP" : "NASDAQ")}:${symbol.replace(/^\^/, "")}`;
  const asset: Asset = {
    id: `stock:${symbol}`,
    symbol: symbol.replace(/^\^/, ""),
    name,
    kind: isIndex ? "index" : "equity",
    yahooSymbol: symbol,
    cnbcSymbol: symbol,
    tradingView: tvSymbol,
    links: [
      { label: "TradingView", href: tv(tvSymbol) },
      { label: "Yahoo", href: `https://finance.yahoo.com/quote/${symbol}` },
    ],
  };
  return [
    {
      key: asset.id,
      group: "stock",
      asset,
      detail: [exch, isIndex ? "index" : "equity", "live"].filter(Boolean).join(" · "),
    },
  ];
}

export function isTickerQuery(query: string): boolean {
  return /^[A-Za-z.]{1,8}$/.test(query.trim());
}

function defaultSpxHit(query: string): SearchHit[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, "");
  if (!/^(s&p|s&p500|spx|sp500|\.spx|\^gspc|gspc)$/.test(q) && !q.includes("s&p")) {
    return [];
  }
  const asset = DEFAULT_ASSETS.find((a) => a.id === "spx");
  if (!asset) return [];
  return [
    {
      key: asset.id,
      group: "stock",
      asset,
      detail: "index · S&P 500",
    },
  ];
}

export async function searchMarkets(query: string): Promise<SearchHit[]> {
  const q = query.trim();
  if (q.length < 1) return [];
  const jobs = await Promise.allSettled([
    Promise.resolve(defaultSpxHit(q)),
    confirmTicker(q),
    searchCoins(q),
    searchDex(q),
    searchStocks(q),
  ]);
  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  for (const job of jobs) {
    if (job.status !== "fulfilled") continue;
    for (const hit of job.value) {
      const dedupe = `${hit.group}:${hit.asset.symbol}`;
      if (hit.group === "stock" && seen.has(dedupe)) continue;
      if (hit.group === "stock") seen.add(dedupe);
      hits.push(hit);
    }
  }
  if (isTickerQuery(q) && !hits.some((h) => h.group === "stock")) {
    hits.unshift(tickerFallback(q));
  }
  return hits;
}
