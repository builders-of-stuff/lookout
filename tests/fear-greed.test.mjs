import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createServer } from "vite";

const server = await createServer({
  server: { middlewareMode: true, watch: null, ws: false },
});
const {
  assembleFearGreed,
  bandFromLabel,
  bandFromScore,
  parseCryptoFearGreed,
  parseStockFearGreed,
} = await server.ssrLoadModule("/src/lib/fear-greed.ts");

after(async () => {
  await server.close();
});

test("fear and greed bands follow the usual 25/45/55/75 cuts", () => {
  assert.equal(bandFromScore(0), "extreme-fear");
  assert.equal(bandFromScore(24.9), "extreme-fear");
  assert.equal(bandFromScore(25), "fear");
  assert.equal(bandFromScore(44), "fear");
  assert.equal(bandFromScore(45), "neutral");
  assert.equal(bandFromScore(54.9), "neutral");
  assert.equal(bandFromScore(55), "greed");
  assert.equal(bandFromScore(74), "greed");
  assert.equal(bandFromScore(75), "extreme-greed");
  assert.equal(bandFromScore(100), "extreme-greed");
});

test("API labels win over the numeric band when they are specific", () => {
  assert.equal(bandFromLabel("Extreme Fear", 50), "extreme-fear");
  assert.equal(bandFromLabel("extreme greed", 40), "extreme-greed");
  assert.equal(bandFromLabel("Fear", 10), "fear");
  assert.equal(bandFromLabel("unknown", 80), "extreme-greed");
});

test("crypto parser keeps newest last and uses yesterday as the last print", () => {
  const reading = parseCryptoFearGreed({
    name: "Fear and Greed Index",
    data: [
      { value: "69", value_classification: "Greed", timestamp: "1788825600" },
      { value: "71", value_classification: "Greed", timestamp: "1788739200" },
      { value: "73", timestamp: "1788652800" },
      { value: "73", timestamp: "1788566400" },
      { value: "74", timestamp: "1788480000" },
      { value: "65", timestamp: "1788393600" },
      { value: "63", timestamp: "1788307200" },
      { value: "50", timestamp: "1788220800" },
    ],
    metadata: { error: null },
  });
  assert.equal(reading.market, "crypto");
  assert.equal(reading.score, 69);
  assert.equal(reading.band, "greed");
  assert.equal(reading.previous, 71);
  assert.equal(reading.weekAgo, 50);
  assert.deepEqual(reading.history, [50, 63, 65, 74, 73, 73, 71, 69]);
  assert.equal(reading.source, "Alternative.me");
});

test("stock parser reads the CNN headline score, history, and legs", () => {
  const reading = parseStockFearGreed({
    fear_and_greed: {
      score: 41.028,
      rating: "fear",
      timestamp: "2026-09-08T19:59:59+00:00",
      previous_close: 41.857,
      previous_1_week: 30.914,
    },
    fear_and_greed_historical: {
      data: [
        { x: 1, y: 22 },
        { x: 2, y: 40.77 },
        { x: 3, y: 41.02 },
      ],
    },
    market_momentum_sp500: { score: 31.2, rating: "fear" },
    stock_price_strength: { score: 12, rating: "extreme fear" },
    put_call_options: { score: 53, rating: "neutral" },
  });
  assert.equal(reading.market, "stocks");
  assert.equal(reading.score, 41.028);
  assert.equal(reading.band, "fear");
  assert.equal(reading.previous, 41.857);
  assert.equal(reading.weekAgo, 30.914);
  assert.deepEqual(reading.history, [22, 40.77, 41.02]);
  assert.equal(reading.legs.length, 3);
  assert.equal(reading.legs[1].band, "extreme-fear");
  assert.equal(reading.source, "CNN");
});

test("one dead feed does not wipe the other market", () => {
  const crypto = {
    status: "fulfilled",
    value: parseCryptoFearGreed({
      data: [{ value: "20", value_classification: "Extreme Fear", timestamp: "1" }],
    }),
  };
  const stocks = { status: "rejected", reason: new Error("403 /api/cnn-fng") };
  const assembled = assembleFearGreed(crypto, stocks);
  assert.equal(assembled.crypto?.score, 20);
  assert.equal(assembled.stocks, null);
  assert.equal(assembled.errors.length, 1);
  assert.match(assembled.errors[0], /403/);
});
