const test = require("node:test");
const assert = require("node:assert/strict");

test("product model normalises API records and calculates specials", async () => {
  const {
    apiProductToView,
    average,
    discountRatio,
    isOnSpecial,
    minPrice,
    specialSaving,
  } = await import("../frontend/product-model.mjs");

  const product = apiProductToView({
    id: "ww-808766",
    stockcode: "808766",
    name: "Cotton Softs Toilet Paper",
    current: 6,
    originalPrice: 7.99,
    promo: "Special",
    availabilityStatus: "In Stock",
    category: "Household",
    capturedAt: "2026-07-23T00:00:00.000Z",
  });
  product.history = [7.99, 6.99, 6];

  assert.equal(product.category, "Household");
  assert.equal(minPrice(product), 6);
  assert.equal(average(product), 6.993333333333333);
  assert.ok(discountRatio(product) > 0);
  assert.equal(isOnSpecial(product), true);
  assert.equal(specialSaving(product), 1.9900000000000002);
});

test("product model handles empty and invalid history safely", async () => {
  const { discountRatio, priceHistory } = await import("../frontend/product-model.mjs");
  const product = { current: 0, history: [null, "invalid"] };

  assert.deepEqual(priceHistory(product), [0]);
  assert.equal(discountRatio(product), 0);
});

test("out-of-stock prices do not count as deals or available history", async () => {
  const { isAvailable, isNearLow, minPrice, signalKeyFor } = await import("../frontend/product-model.mjs");
  const product = {
    current: 1,
    source: "api",
    availabilityStatus: "Out of Stock",
    history: [4, 1],
    historyAvailability: ["In Stock", "Out of Stock"],
  };

  assert.equal(isAvailable(product), false);
  assert.equal(isNearLow(product), false);
  assert.equal(minPrice(product), 4);
  assert.equal(signalKeyFor(product), "outOfStock");
});
