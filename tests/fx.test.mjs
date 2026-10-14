import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createServer } from "vite";

const server = await createServer({
  server: { middlewareMode: true, watch: null, ws: false },
});
const { parseUsdCad, USD_CAD_URL } = await server.ssrLoadModule(
  "/src/lib/fx.svelte.ts",
);

after(async () => {
  await server.close();
});

const quote = (fields) => ({
  FormattedQuoteResult: {
    FormattedQuote: [{ symbol: "CAD=", name: "USD/CAD", ...fields }],
  },
});

test("USD/CAD reads CNBC's last print, change, and timestamp", () => {
  const usdCad = parseUsdCad(
    quote({
      last: "1.4212",
      change: "-0.0002",
      change_pct: "-0.0141%",
      last_time: "2026-10-14T06:33:00.000-0400",
    }),
  );
  assert.equal(usdCad.rate, 1.4212);
  assert.equal(usdCad.change, -0.0002);
  assert.equal(usdCad.changePct, -0.0141);
  assert.equal(usdCad.asOf, Date.parse("2026-10-14T10:33:00.000Z"));
});

test("USD/CAD keeps a leading plus and works out a missing percent", () => {
  const usdCad = parseUsdCad(quote({ last: "1.4000", change: "+0.0140" }));
  assert.equal(usdCad.change, 0.014);
  assert.ok(Math.abs(usdCad.changePct - 1.0101) < 0.001);
});

test("USD/CAD refuses a reply without a usable rate", () => {
  assert.throws(() => parseUsdCad({}), /no USD\/CAD rate/);
  assert.throws(() => parseUsdCad(quote({ last: "UNCH" })), /no USD\/CAD rate/);
  assert.throws(
    () =>
      parseUsdCad({
        FormattedQuoteResult: { FormattedQuote: [{ symbol: "EUR=", last: "0.92" }] },
      }),
    /no USD\/CAD rate/,
  );
});

test("USD/CAD asks the CNBC route for CAD=", () => {
  assert.match(USD_CAD_URL, /^\/api\/cnbc\//);
  assert.match(USD_CAD_URL, /symbols=CAD%3D&/);
});
