const test = require("node:test");
const assert = require("node:assert/strict");

const {
  auditProducts,
  comparableSize,
  priceMismatch,
  unitPriceRate,
} = require("../scripts/audit-product-data");

test("product audit compares package price with unit price", () => {
  assert.deepEqual(comparableSize("2L"), { dimension: "volume", amount: 2000 });
  assert.deepEqual(comparableSize("10 x 70g"), { dimension: "mass", amount: 700 });
  assert.deepEqual(comparableSize("20 pack · 360g"), { dimension: "mass", amount: 360 });
  assert.deepEqual(unitPriceRate("$3.02 / 1L"), {
    dimension: "volume",
    pricePerBaseUnit: 0.00302,
  });
  assert.equal(
    priceMismatch({ stockcode: "1", name: "Milk", size: "2L", current: 6.03, unitPrice: "$3.02 / 1L" }),
    null
  );
  assert.ok(priceMismatch({ stockcode: "2", name: "Milk", size: "2L", current: 9, unitPrice: "$3.02 / 1L" }));
});

test("product audit reports exact same-name and same-size groups", () => {
  const result = auditProducts([
    { stockcode: "1", name: "Milk", size: "1L", current: 3, unitPrice: "$3.00 / 1L", imageUrl: "one" },
    { stockcode: "2", name: "Milk", size: "1L", current: 4, unitPrice: "$4.00 / 1L", imageUrl: "two" },
  ]);

  assert.equal(result.sameNameAndSize.length, 1);
  assert.deepEqual(result.sameNameAndSize[0].stockcodes, ["1", "2"]);
});
