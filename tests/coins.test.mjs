import assert from "node:assert/strict";
import { after, afterEach, beforeEach, mock, test } from "node:test";
import { createServer } from "vite";

const server = await createServer({
  server: { middlewareMode: true, watch: null, ws: false },
});
const { DEFAULT_ASSETS } = await server.ssrLoadModule("/src/lib/assets.ts");
const { searchMarkets } = await server.ssrLoadModule("/src/lib/search.ts");
const { sameAsset } = await server.ssrLoadModule("/src/lib/watchlist.ts");
const originalFetch = globalThis.fetch;

// The feed pacing lives in module state, so each test loads its own copy.
let copies = 0;
const freshCoins = async () =>
  (await server.ssrLoadModule(`/src/lib/coins.ts?copy=${copies++}`)).fetchCoins;

const btc = DEFAULT_ASSETS.find((asset) => asset.id === "btc");
const doge = {
  id: "gecko:dogecoin",
  symbol: "DOGE",
  name: "Dogecoin",
  kind: "crypto",
  geckoId: "dogecoin",
  links: [],
};

const VENUES = {
  "data-api.binance.vision": "binance",
  "api.exchange.coinbase.com": "coinbase",
  "api.kraken.com": "kraken",
  "api.coingecko.com": "gecko",
  "api.coinpaprika.com": "paprika",
};
const EXCHANGES = ["binance", "coinbase", "kraken"];

let calls;
// (venue, url) => true to answer like a refusal without CORS headers.
let fail;

function reply(venue, url) {
  const path = new URL(url).pathname;
  const now = Date.now();
  if (venue === "binance") {
    if (path.endsWith("/klines")) {
      return [
        [now - 3_600_000, "90", "0", "0", "95"],
        [now, "95", "0", "0", "100"],
      ];
    }
    return { lastPrice: "100", openPrice: "80", quoteVolume: "5000" };
  }
  if (venue === "coinbase") {
    if (path.endsWith("/candles")) return [[now / 1000, "0", "0", "100", "101", "1"]];
    return { last: "101", open: "100", volume: "10" };
  }
  if (venue === "kraken") {
    // 26 hourly rows; the one 24 hours back opens at 51, the latest closes at 76.
    const rows = Array.from({ length: 26 }, (_, i) => [
      now / 1000 - (25 - i) * 3600,
      String(50 + i),
      "0",
      "0",
      String(51 + i),
      "2",
      "3",
      1,
    ]);
    return { error: [], result: { XXBTZUSD: rows, last: now / 1000 } };
  }
  if (venue === "gecko") {
    if (path.endsWith("/coins/markets")) {
      return [
        {
          id: "bitcoin",
          current_price: 99,
          price_change_percentage_24h: 1,
          total_volume: 1e9,
          market_cap: 1980,
          sparkline_in_7d: { price: [97, 98, 99] },
        },
      ];
    }
    return {
      bitcoin: { usd: 99, usd_24h_change: 1, usd_24h_vol: 1e9, usd_market_cap: 1980 },
      dogecoin: { usd: 0.1, usd_24h_change: 3, usd_24h_vol: 1e8, usd_market_cap: 15 },
    };
  }
  if (venue === "paprika") {
    if (path.endsWith("/search")) {
      return {
        currencies: [
          { id: "doge-dogecoin", name: "Dogecoin", symbol: "DOGE", rank: 12 },
        ],
      };
    }
    return {
      quotes: {
        USD: { price: 98, percent_change_24h: 2, volume_24h: 2e9, market_cap: 1960 },
      },
    };
  }
  return {};
}

beforeEach(() => {
  mock.timers.enable({ apis: ["Date"], now: 1_790_000_000_000 });
  calls = [];
  fail = () => false;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input), "http://localhost").href;
    const venue = VENUES[new URL(url).hostname] ?? "other";
    calls.push({ venue, url });
    if (fail(venue, url)) throw new TypeError("Failed to fetch");
    return Response.json(reply(venue, url));
  };
});

afterEach(() => mock.timers.reset());

after(async () => {
  globalThis.fetch = originalFetch;
  await server.close();
});

const count = (venue, part = "") =>
  calls.filter((c) => c.venue === venue && c.url.includes(part)).length;

test("the first exchange prices a coin; CoinGecko adds market cap and volume", async () => {
  const fetchCoins = await freshCoins();
  const { quotes, errors } = await fetchCoins([btc], false);
  assert.deepEqual(errors, []);
  assert.equal(quotes[0].source, "Binance");
  assert.equal(quotes[0].price, 100);
  assert.equal(quotes[0].changePct, 25);
  assert.equal(quotes[0].changeAbs, 20);
  // CoinGecko's cap implies a supply of 20 coins, priced at Binance's 100.
  assert.equal(quotes[0].marketCap, 2000);
  assert.equal(quotes[0].volume, 1e9);
  assert.deepEqual([count("coinbase"), count("kraken"), count("paprika")], [0, 0, 0]);
});

test("a coin falls through to the next exchange, and only that pair backs off", async () => {
  const fetchCoins = await freshCoins();
  fail = (venue, url) => venue === "binance" && url.includes("BTCUSDT");
  let { quotes } = await fetchCoins([btc, doge], false);
  const source = (id) => quotes.find((q) => q.id === id)?.source;
  assert.equal(source(btc.id), "Coinbase");
  assert.equal(source(doge.id), "Binance");

  ({ quotes } = await fetchCoins([btc, doge], false));
  assert.equal(source(btc.id), "Coinbase");
  assert.equal(count("binance", "BTCUSDT"), 1);
  assert.equal(count("binance", "DOGEUSDT"), 2);

  mock.timers.tick(60_000);
  await fetchCoins([btc, doge], false);
  assert.equal(count("binance", "BTCUSDT"), 2);
});

test("Kraken prices from hourly candles when Binance and Coinbase fail", async () => {
  const fetchCoins = await freshCoins();
  fail = (venue) => venue === "binance" || venue === "coinbase";
  const { quotes } = await fetchCoins([btc], false);
  assert.equal(quotes[0].source, "Kraken");
  assert.equal(quotes[0].price, 76);
  assert.equal(quotes[0].changeAbs, 25);
});

test("with the exchanges down, CoinGecko prices a coin, then CoinPaprika", async () => {
  const fetchCoins = await freshCoins();
  fail = (venue) => EXCHANGES.includes(venue);
  let { quotes } = await fetchCoins([btc], false);
  assert.equal(quotes[0].source, "CoinGecko");
  assert.equal(quotes[0].price, 99);
  assert.equal(quotes[0].marketCap, 1980);

  fail = (venue) => EXCHANGES.includes(venue) || venue === "gecko";
  mock.timers.tick(60_000);
  ({ quotes } = await fetchCoins([btc], false));
  assert.equal(quotes[0].source, "CoinPaprika");
  assert.equal(quotes[0].price, 98);
  assert.equal(quotes[0].marketCap, 1960);
});

test("CoinGecko is asked at most once a minute and backs off after failures", async () => {
  const fetchCoins = await freshCoins();
  await fetchCoins([btc], false);
  await fetchCoins([btc], false);
  assert.equal(count("gecko"), 1);
  mock.timers.tick(59_999);
  await fetchCoins([btc], false);
  assert.equal(count("gecko"), 1);
  mock.timers.tick(1);
  await fetchCoins([btc], false);
  assert.equal(count("gecko"), 2);

  fail = (venue) => venue === "gecko";
  mock.timers.tick(60_000);
  const { quotes } = await fetchCoins([btc], false);
  assert.equal(count("gecko"), 3);
  // CoinPaprika takes over the market cap: 1960 / 98 = 20 coins at 100.
  assert.equal(count("paprika"), 1);
  assert.equal(quotes[0].marketCap, 2000);
  mock.timers.tick(119_999);
  await fetchCoins([btc], false);
  assert.equal(count("gecko"), 3);
  mock.timers.tick(1);
  await fetchCoins([btc], false);
  assert.equal(count("gecko"), 4);
});

test("a coin every feed fails for is reported; one waiting its turn is not", async () => {
  let fetchCoins = await freshCoins();
  fail = () => true;
  let batch = await fetchCoins([btc], false);
  assert.deepEqual(batch.quotes, []);
  assert.deepEqual(batch.errors, ["BTC: every price feed failed"]);

  fetchCoins = await freshCoins();
  fail = (venue) => EXCHANGES.includes(venue);
  batch = await fetchCoins([btc], false);
  assert.equal(batch.quotes[0].source, "CoinGecko");
  batch = await fetchCoins([btc], false);
  assert.deepEqual(batch, { quotes: [], seeds: {}, errors: [] });
});

test("the chart seeds from the exchange's candles, else CoinGecko's sparkline", async () => {
  let fetchCoins = await freshCoins();
  let { seeds } = await fetchCoins([btc], true);
  assert.deepEqual(
    seeds[btc.id].map((t) => t.p),
    [95, 100],
  );
  assert.equal(count("gecko", "/coins/markets"), 1);

  fetchCoins = await freshCoins();
  fail = (venue, url) => url.includes("/klines");
  ({ seeds } = await fetchCoins([btc], true));
  assert.deepEqual(
    seeds[btc.id].map((t) => t.p),
    [97, 98, 99],
  );
});

test("coin search falls back to CoinPaprika when CoinGecko fails", async () => {
  fail = (venue) => venue === "gecko";
  const hits = await searchMarkets("doge");
  const coin = hits.find((hit) => hit.group === "coin");
  assert.equal(coin.asset.id, "paprika:doge-dogecoin");
  assert.equal(coin.asset.paprikaId, "doge-dogecoin");
  assert.equal(coin.detail, "mcap #12");
  // The same coin already on the desk from CoinGecko is not added twice.
  assert.equal(sameAsset(coin.asset, doge), true);
});
