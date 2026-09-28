import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { createServer } from "vite";

const server = await createServer({
  server: { middlewareMode: true, watch: null, ws: false },
});
const { DEFAULT_ASSETS, STORAGE_KEY } =
  await server.ssrLoadModule("/src/lib/assets.ts");
const { loadDesk, saveDesk } = await server.ssrLoadModule("/src/lib/storage.ts");
const { Desk } = await server.ssrLoadModule("/src/lib/desk.svelte.ts");
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const originalFetch = globalThis.fetch;
let stored;

const customCoin = {
  id: "gecko:dogecoin",
  symbol: "DOGE",
  name: "Dogecoin",
  kind: "crypto",
  geckoId: "dogecoin",
  links: [],
};
const customStock = {
  id: "stock:NVDA",
  symbol: "NVDA",
  name: "NVIDIA",
  kind: "equity",
  yahooSymbol: "NVDA",
  cnbcSymbol: "NVDA",
  links: [],
};
const assetIds = (state) => state.assets.map((asset) => asset.id);

beforeEach(() => {
  stored = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => stored.get(key) ?? null,
      setItem: (key, value) => stored.set(key, value),
    },
  });
  globalThis.fetch = async () => {
    throw new Error("Offline during persistence test");
  };
});

after(async () => {
  await server.close();
  globalThis.fetch = originalFetch;
  if (originalStorage)
    Object.defineProperty(globalThis, "localStorage", originalStorage);
  else delete globalThis.localStorage;
});

test("defaults seed a new desk, then the saved selection replaces them", () => {
  assert.deepEqual(
    assetIds(loadDesk()),
    DEFAULT_ASSETS.map((asset) => asset.id),
  );
  const chosen = {
    ...loadDesk(),
    assets: [customStock, customCoin],
    focusId: customCoin.id,
  };
  assert.equal(saveDesk(chosen), true);
  assert.deepEqual(assetIds(loadDesk()), [customStock.id, customCoin.id]);
  assert.equal(loadDesk().focusId, customCoin.id);
});

test("legacy custom assets, exclusions, focus and exact order survive migration", () => {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      customAssets: [customStock, customCoin],
      hiddenIds: ["zec", "sol", "eth", "zcat", "tsla", "spcx"],
      order: [customStock.id, "sui", "spx", customCoin.id, "btc"],
      focusId: customStock.id,
      rules: [
        { id: "rule", assetId: "btc", kind: "above", value: 100000, enabled: true },
      ],
    }),
  );
  const migrated = loadDesk();
  assert.deepEqual(assetIds(migrated), [
    customStock.id,
    "sui",
    "spx",
    customCoin.id,
    "btc",
  ]);
  assert.equal(migrated.focusId, customStock.id);
  assert.equal(migrated.rules.length, 1);
  saveDesk(migrated);
  assert.deepEqual(loadDesk(), migrated);
});

test("a legacy hidden S&P is not restored or pinned", () => {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ hiddenIds: ["spx"], order: ["sui", "btc"] }),
  );
  assert.equal(assetIds(loadDesk()).includes("spx"), false);
  assert.deepEqual(assetIds(loadDesk()).slice(0, 2), ["sui", "btc"]);
});

test("moving cards, including S&P, writes their exact order immediately", () => {
  const desk = new Desk();
  desk.moveAsset("spx", "spcx");
  desk.moveAsset("sui", "btc");
  assert.equal(assetIds(loadDesk())[0], "sui");
  assert.equal(assetIds(loadDesk()).at(-1), "spx");
  assert.deepEqual(assetIds(new Desk()), assetIds(desk));
});

test("additions and removals persist even when every quote request fails", async () => {
  const desk = new Desk();
  desk.removeAsset("spx");
  desk.removeAsset("btc");
  await desk.addAsset(customCoin);
  await desk.addAsset(customStock);
  const reloaded = new Desk();
  assert.deepEqual(assetIds(reloaded), assetIds(desk));
  assert.equal(assetIds(reloaded).includes("spx"), false);
  assert.equal(assetIds(reloaded).includes("btc"), false);
  assert.deepEqual(assetIds(reloaded).slice(-2), [customCoin.id, customStock.id]);
  assert.equal(reloaded.focusId, customStock.id);
  assert.equal(desk.saved, true);
});

test("every card can be removed and an empty watchlist stays empty after reload", async () => {
  const desk = new Desk();
  for (const asset of [...desk.assets]) desk.removeAsset(asset.id);
  assert.deepEqual(assetIds(new Desk()), []);
  assert.equal(loadDesk().focusId, "");
  await desk.poll();
  assert.equal(desk.status, "idle");
  await desk.addAsset(customCoin);
  assert.deepEqual(assetIds(new Desk()), [customCoin.id]);
});

test("re-adding a removed starter appends it without disturbing the other cards", async () => {
  const desk = new Desk();
  desk.moveAsset("sui", "btc");
  desk.removeAsset("spx");
  const before = assetIds(desk);
  const spx = DEFAULT_ASSETS.find((asset) => asset.id === "spx");
  await desk.addAsset({ ...spx, id: "stock:^GSPC" });
  assert.deepEqual(assetIds(new Desk()), [...before, "spx"]);
  await desk.addAsset({ ...spx, id: "stock:^GSPC" });
  assert.deepEqual(assetIds(desk), [...before, "spx"]);
});

test("removing the focused asset moves focus and removes its alerts", () => {
  const desk = new Desk();
  desk.setFocus("spx");
  desk.addRule("spx", "above", 7000);
  desk.removeAsset("spx");
  assert.equal(loadDesk().focusId, "btc");
  assert.deepEqual(loadDesk().rules, []);
});

test("a late quote response cannot bring removed cards back", () => {
  const desk = new Desk();
  desk.removeAsset("btc");
  desk.applyBatch({
    quotes: [
      {
        id: "btc",
        price: 90000,
        changePct: 1,
        changeAbs: 900,
        source: "test",
        asOf: Date.now(),
      },
    ],
    seeds: {},
    errors: [],
  });
  assert.equal(assetIds(loadDesk()).includes("btc"), false);
});

test("changes from another tab replace stale selections before the next save", () => {
  const desk = new Desk();
  saveDesk({ ...loadDesk(), assets: [customStock], focusId: customStock.id });
  desk.onStorage({ key: STORAGE_KEY });
  assert.deepEqual(assetIds(desk), [customStock.id]);
  desk.persist();
  assert.deepEqual(assetIds(loadDesk()), [customStock.id]);
});

test("storage quota pressure drops replaceable quote history before preferences", () => {
  const state = {
    ...loadDesk(),
    assets: [customCoin],
    focusId: customCoin.id,
    ticks: {
      [customCoin.id]: Array.from({ length: 1500 }, (_, i) => ({ t: i * 1000, p: i })),
    },
  };
  localStorage.setItem = (key, value) => {
    if (value.length > 1000) throw new DOMException("Full", "QuotaExceededError");
    stored.set(key, value);
  };
  assert.equal(saveDesk(state), true);
  assert.deepEqual(assetIds(loadDesk()), [customCoin.id]);
  assert.deepEqual(loadDesk().ticks, {});
});

test("unavailable storage reports a failed save while the desk remains usable", () => {
  localStorage.setItem = () => {
    throw new Error("Storage unavailable");
  };
  const desk = new Desk();
  desk.removeAsset("spx");
  assert.equal(desk.saved, false);
  assert.equal(assetIds(desk).includes("spx"), false);
});

test("invalid stored JSON recovers to a usable first-visit desk", () => {
  stored.set(STORAGE_KEY, "{broken");
  assert.deepEqual(
    assetIds(loadDesk()),
    DEFAULT_ASSETS.map((asset) => asset.id),
  );
});
