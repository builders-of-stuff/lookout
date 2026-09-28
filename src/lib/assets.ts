import type { Asset } from "./types";

export const tv = (symbol: string) =>
  `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`;

export const DEFAULT_ASSETS: Asset[] = [
  {
    id: "btc",
    symbol: "BTC",
    name: "Bitcoin",
    kind: "crypto",
    geckoId: "bitcoin",
    tradingView: "BINANCE:BTCUSDT",
    links: [
      { label: "TradingView", href: tv("BINANCE:BTCUSDT") },
      { label: "CMC", href: "https://coinmarketcap.com/currencies/bitcoin/" },
      {
        label: "DexScreener",
        href: "https://dexscreener.com/search?q=BTC",
      },
    ],
  },
  {
    id: "spx",
    symbol: "S&P",
    name: "S&P 500",
    kind: "index",
    yahooSymbol: "^GSPC",
    cnbcSymbol: ".SPX",
    // SP:SPX is gated in the free embed widget.
    tradingView: "FOREXCOM:SPXUSD",
    links: [
      { label: "TradingView", href: tv("FOREXCOM:SPXUSD") },
      { label: "SPY", href: tv("AMEX:SPY") },
      { label: "Yahoo", href: "https://finance.yahoo.com/quote/%5EGSPC" },
    ],
  },
  {
    id: "zec",
    symbol: "ZEC",
    name: "Zcash",
    kind: "crypto",
    geckoId: "zcash",
    tradingView: "BINANCE:ZECUSDT",
    links: [
      { label: "TradingView", href: tv("BINANCE:ZECUSDT") },
      { label: "CMC", href: "https://coinmarketcap.com/currencies/zcash/" },
      {
        label: "DexScreener",
        href: "https://dexscreener.com/search?q=ZEC",
      },
    ],
  },
  {
    id: "sol",
    symbol: "SOL",
    name: "Solana",
    kind: "crypto",
    geckoId: "solana",
    tradingView: "BINANCE:SOLUSDT",
    links: [
      { label: "TradingView", href: tv("BINANCE:SOLUSDT") },
      { label: "CMC", href: "https://coinmarketcap.com/currencies/solana/" },
      { label: "DexScreener", href: "https://dexscreener.com/solana" },
    ],
  },
  {
    id: "sui",
    symbol: "SUI",
    name: "Sui",
    kind: "crypto",
    geckoId: "sui",
    tradingView: "BINANCE:SUIUSDT",
    links: [
      { label: "TradingView", href: tv("BINANCE:SUIUSDT") },
      { label: "CMC", href: "https://coinmarketcap.com/currencies/sui/" },
      { label: "DexScreener", href: "https://dexscreener.com/sui" },
    ],
  },
  {
    id: "eth",
    symbol: "ETH",
    name: "Ethereum",
    kind: "crypto",
    geckoId: "ethereum",
    tradingView: "BINANCE:ETHUSDT",
    links: [
      { label: "TradingView", href: tv("BINANCE:ETHUSDT") },
      { label: "CMC", href: "https://coinmarketcap.com/currencies/ethereum/" },
      {
        label: "DexScreener",
        href: "https://dexscreener.com/search?q=ETH",
      },
    ],
  },
  {
    id: "zcat",
    symbol: "ZCAT",
    name: "Anonymous Cat",
    kind: "dex",
    chain: "solana",
    tokenAddress: "HcRLc9VDgjLeK154xDawfb1dmVJ98DoSqcwTHGqiDeJR",
    dexEmbed: "solana",
    links: [
      {
        label: "DexScreener",
        href: "https://dexscreener.com/solana/HcRLc9VDgjLeK154xDawfb1dmVJ98DoSqcwTHGqiDeJR",
      },
      {
        label: "Solscan",
        href: "https://solscan.io/token/HcRLc9VDgjLeK154xDawfb1dmVJ98DoSqcwTHGqiDeJR",
      },
    ],
  },
  {
    id: "tsla",
    symbol: "TSLA",
    name: "Tesla",
    kind: "equity",
    yahooSymbol: "TSLA",
    cnbcSymbol: "TSLA",
    tradingView: "NASDAQ:TSLA",
    links: [
      { label: "TradingView", href: tv("NASDAQ:TSLA") },
      { label: "Yahoo", href: "https://finance.yahoo.com/quote/TSLA" },
    ],
  },
  {
    id: "spcx",
    symbol: "SPCX",
    name: "SpaceX",
    kind: "equity",
    yahooSymbol: "SPCX",
    cnbcSymbol: "SPCX",
    tradingView: "NASDAQ:SPCX",
    links: [
      { label: "TradingView", href: tv("NASDAQ:SPCX") },
      { label: "Yahoo", href: "https://finance.yahoo.com/quote/SPCX" },
    ],
  },
];

export const POLL_MS = 20_000;
export const MOOD_POLL_MS = 15 * 60 * 1000;
export const TICK_CAP = 1500;
export const ALERT_COOLDOWN_MS = 5 * 60 * 1000;
export const STORAGE_KEY = "night-tape.v1";
