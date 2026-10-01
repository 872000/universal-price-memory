const test = require("node:test");
const assert = require("node:assert/strict");

const { numberOption, parseArgs } = require("../lib/cli");
const {
  parseUiVersion,
  productUrl,
  stockcodeFromInput,
  textFrom,
} = require("../lib/woolworths");

test("parseArgs handles values and boolean flags", () => {
  const args = parseArgs(["node", "script", "--limit", "20", "--debug"], { pages: 1 });
  assert.deepEqual(args, { pages: 1, limit: "20", debug: true });
});

test("numberOption rejects invalid command values", () => {
  assert.equal(numberOption("3", { name: "pages", defaultValue: 1, min: 1, integer: true }), 3);
  assert.throws(
    () => numberOption("not-a-number", { name: "pages", defaultValue: 1, min: 1, integer: true }),
    /--pages must be/
  );
  assert.throws(
    () => numberOption("1.5", { name: "pages", defaultValue: 1, min: 1, integer: true }),
    /--pages must be/
  );
});

test("stockcodeFromInput supports Woolworths URL formats", () => {
  assert.equal(stockcodeFromInput("808766"), "808766");
  assert.equal(
    stockcodeFromInput("https://www.woolworths.co.nz/shop/productdetails?stockcode=808766&name=paper"),
    "808766"
  );
  assert.equal(stockcodeFromInput("https://www.woolworths.co.nz/shop/productdetails/808766"), "808766");
  assert.equal(stockcodeFromInput("not-a-product"), null);
});

test("shared Woolworths helpers normalise common page values", () => {
  assert.equal(parseUiVersion('<script>uiVersion: "9.1.2"</script>'), "9.1.2");
  assert.equal(textFrom("  Milk &amp; cream\n"), "Milk & cream");
  assert.equal(
    productUrl("808766", "cotton-softs").toString(),
    "https://www.woolworths.co.nz/shop/productdetails?stockcode=808766&name=cotton-softs"
  );
});
