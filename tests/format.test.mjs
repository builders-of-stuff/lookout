import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createServer } from "vite";

const server = await createServer({
  server: { middlewareMode: true, watch: null, ws: false },
});
const { shortenAddress, tokenFieldLabel } =
  await server.ssrLoadModule("/src/lib/format.ts");
const { copyText } = await server.ssrLoadModule("/src/lib/clipboard.ts");

after(async () => {
  await server.close();
});

test("shortenAddress keeps short values and trims the rest", () => {
  assert.equal(shortenAddress("abcd"), "abcd");
  assert.equal(
    shortenAddress("HcRLc9VDgjLeK154xDawfb1dmVJ98DoSqcwTHGqiDeJR"),
    "HcRL…DeJR",
  );
  assert.equal(shortenAddress("0x1234567890abcdef", 6, 4), "0x1234…cdef");
});

test("tokenFieldLabel follows the chain", () => {
  assert.equal(tokenFieldLabel("solana"), "Mint");
  assert.equal(tokenFieldLabel("ethereum"), "Contract");
  assert.equal(tokenFieldLabel("base"), "Contract");
  assert.equal(tokenFieldLabel(), "Token");
});

test("copyText writes to the clipboard API", async () => {
  const previous = globalThis.navigator;
  let written = "";
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      clipboard: {
        writeText: async (text) => {
          written = text;
        },
      },
    },
  });
  try {
    assert.equal(await copyText("  mint-address  "), true);
    assert.equal(written, "mint-address");
    assert.equal(await copyText("   "), false);
  } finally {
    if (previous === undefined) delete globalThis.navigator;
    else
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: previous,
      });
  }
});
