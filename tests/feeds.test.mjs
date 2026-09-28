import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import { createServer } from "vite";

const server = await createServer({
  server: { middlewareMode: true, watch: null, ws: false },
});
const { fetchQuota, quotaResponse } = await server.ssrLoadModule("/worker/quota.ts");
const { feedLog, trackedFetch } = await server.ssrLoadModule(
  "/src/lib/feed-log.svelte.ts",
);
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

after(async () => {
  await server.close();
});

function analytics(all, mine) {
  return new Response(
    JSON.stringify({
      data: {
        viewer: {
          accounts: [
            { all: [{ sum: { requests: all } }], mine: [{ sum: { requests: mine } }] },
          ],
        },
      },
    }),
  );
}

test("fetchQuota totals every Worker since midnight UTC", async () => {
  let sent;
  globalThis.fetch = async (url, init) => {
    sent = { url, init, body: JSON.parse(init.body) };
    return analytics(3412, 3380);
  };
  const report = await fetchQuota("tok", "acct", new Date("2026-09-28T14:05:00Z"));
  assert.equal(report.used, 3412);
  assert.equal(report.limit, 100_000);
  assert.equal(report.lookout, 3380);
  assert.equal(sent.body.variables.script, "lookout");
  assert.equal(sent.url, "https://api.cloudflare.com/client/v4/graphql");
  assert.equal(sent.init.headers.Authorization, "Bearer tok");
  assert.equal(sent.body.variables.account, "acct");
  assert.equal(sent.body.variables.start, "2026-09-28T00:00:00.000Z");
  assert.equal(sent.body.variables.end, "2026-09-28T14:05:00.000Z");
});

test("fetchQuota surfaces GraphQL errors", async () => {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({ data: null, errors: [{ message: "not authorized" }] }),
    );
  await assert.rejects(fetchQuota("tok", "acct"), /not authorized/);
});

test("quotaResponse explains missing settings instead of calling Cloudflare", async () => {
  globalThis.fetch = async () => assert.fail("should not fetch");
  const res = await quotaResponse(undefined, "acct");
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /ANALYTICS_TOKEN/);
});

test("trackedFetch logs Worker and direct calls, including failures", async () => {
  globalThis.fetch = async (url) =>
    url.startsWith("/api/") ? new Response("{}", { status: 429 }) : new Response("{}");
  await trackedFetch("/api/cnbc/quote?symbols=TSLA");
  await trackedFetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin");
  assert.equal(feedLog.cnbc.name, "CNBC");
  assert.equal(feedLog.cnbc.worker, true);
  assert.equal(feedLog.cnbc.ok, false);
  assert.equal(feedLog.cnbc.status, 429);
  assert.equal(feedLog["api.coingecko.com"].name, "CoinGecko");
  assert.equal(feedLog["api.coingecko.com"].worker, false);
  assert.equal(feedLog["api.coingecko.com"].ok, true);

  globalThis.fetch = async () => {
    throw new TypeError("network down");
  };
  await assert.rejects(trackedFetch("/api/fng/fng/?limit=8"), /network down/);
  assert.equal(feedLog.fng.ok, false);
  assert.equal(feedLog.fng.status, null);
});
