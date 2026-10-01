const test = require("node:test");
const assert = require("node:assert/strict");

test("product search matches brand, product words, punctuation variants, and typos", async () => {
  const { matchesProductSearch } = await import("../frontend/search.mjs");
  const product = {
    stockcode: "123456",
    name: "Cheddar Dippers Original",
    brand: "Go Nutz",
    category: "Snacks",
    size: "120g",
  };

  assert.equal(matchesProductSearch(product, "gonutz"), true);
  assert.equal(matchesProductSearch(product, "go nutz"), true);
  assert.equal(matchesProductSearch(product, "cheddardippers"), true);
  assert.equal(matchesProductSearch(product, "cheddar dippers"), true);
  assert.equal(matchesProductSearch(product, "chedar dipers"), true);
  assert.equal(matchesProductSearch(product, "123456"), true);
  assert.equal(matchesProductSearch(product, "yoghurt"), false);
});
