const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { resolveStaticPath } = require("../server");

test("static server exposes only public application assets", () => {
  assert.equal(path.basename(resolveStaticPath("/")), "index.html");
  assert.equal(path.basename(resolveStaticPath("/styles.css")), "styles.css");
  assert.equal(path.basename(resolveStaticPath("/icons/icon-192.png")), "icon-192.png");
  assert.equal(path.basename(resolveStaticPath("/frontend/app.mjs")), "app.mjs");
});

test("static server refuses database, source, and traversal paths", () => {
  assert.equal(resolveStaticPath("/data/price-tracker.sqlite"), null);
  assert.equal(resolveStaticPath("/app.js"), null);
  assert.equal(resolveStaticPath("/lib/db.js"), null);
  assert.equal(resolveStaticPath("/scripts/collect-woolworths-prices.js"), null);
  assert.equal(resolveStaticPath("/frontend/not-public.mjs"), null);
  assert.equal(resolveStaticPath("/../data/price-tracker.sqlite"), null);
  assert.equal(resolveStaticPath("/%E0%A4%A"), null);
});
