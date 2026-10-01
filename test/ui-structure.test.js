const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.resolve(__dirname, "..", "index.html"), "utf8");
const css = fs.readFileSync(path.resolve(__dirname, "..", "styles.css"), "utf8");

test("AI summary is hidden in a dialog until its detail action is used", () => {
  const overlayIndex = html.indexOf('id="aiOverlay"');
  const summaryIndex = html.indexOf('id="aiSummary"');

  assert.match(html, /id="openAiButton"/);
  assert.match(html, /id="aiOverlay" hidden/);
  assert.ok(overlayIndex >= 0 && summaryIndex > overlayIndex);
});

test("watchlist remains a compact standalone panel", () => {
  assert.match(html, /class="watchlist-panel"/);
  assert.doesNotMatch(html, /class="insight-panel"/);
});

test("catalog uses normal page scrolling instead of a locked inner viewport", () => {
  assert.doesNotMatch(css, /\.catalog-panel\s*\{[^}]*max-height/);
  assert.match(css, /\.product-list\s*\{[^}]*overflow:\s*visible/);
});

test("catalog defaults to in-stock products while keeping an explicit availability control", () => {
  assert.match(html, /id="inStockOnlyInput"[^>]*checked/);
  assert.match(html, /data-i18n="inStockOnly"/);
  assert.match(css, /\.product-card\.out-of-stock/);
});
