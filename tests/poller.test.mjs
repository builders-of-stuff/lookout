import assert from "node:assert/strict";
import { after, afterEach, beforeEach, mock, test } from "node:test";
import { createServer } from "vite";

const server = await createServer({
  server: { middlewareMode: true, watch: null, ws: false },
});
const { startPoll } = await server.ssrLoadModule("/src/lib/poller.ts");
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");

let page;

function setHidden(hidden) {
  page.hidden = hidden;
  page.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  page = Object.assign(new EventTarget(), { hidden: false });
  Object.defineProperty(globalThis, "document", { value: page, configurable: true });
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
});

afterEach(() => mock.timers.reset());

after(async () => {
  if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
  else delete globalThis.document;
  await server.close();
});

test("polls at once, then every interval while visible", () => {
  let runs = 0;
  const stop = startPoll(() => runs++, 20_000);
  assert.equal(runs, 1);
  mock.timers.tick(19_999);
  assert.equal(runs, 1);
  mock.timers.tick(1);
  assert.equal(runs, 2);
  mock.timers.tick(20_000);
  mock.timers.tick(20_000);
  assert.equal(runs, 4);
  stop();
  mock.timers.tick(60_000);
  assert.equal(runs, 4);
});

test("a hidden tab makes no calls", () => {
  let runs = 0;
  const stop = startPoll(() => runs++, 20_000);
  setHidden(true);
  mock.timers.tick(10 * 60_000);
  assert.equal(runs, 1);
  stop();
});

test("coming back after a missed cycle polls immediately", () => {
  let runs = 0;
  const stop = startPoll(() => runs++, 20_000);
  setHidden(true);
  mock.timers.tick(45_000);
  setHidden(false);
  assert.equal(runs, 2);
  mock.timers.tick(20_000);
  assert.equal(runs, 3);
  stop();
});

test("coming back early waits out the rest of the interval", () => {
  let runs = 0;
  const stop = startPoll(() => runs++, 20_000);
  mock.timers.tick(5_000);
  setHidden(true);
  mock.timers.tick(5_000);
  setHidden(false);
  assert.equal(runs, 1);
  mock.timers.tick(9_999);
  assert.equal(runs, 1);
  mock.timers.tick(1);
  assert.equal(runs, 2);
  stop();
});

test("a tab opened in the background waits until it is shown", () => {
  page.hidden = true;
  let runs = 0;
  const stop = startPoll(() => runs++, 20_000);
  mock.timers.tick(60_000);
  assert.equal(runs, 0);
  setHidden(false);
  assert.equal(runs, 1);
  stop();
});
