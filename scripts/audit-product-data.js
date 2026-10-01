#!/usr/bin/env node

const { listProducts } = require("../lib/db");

function comparableSize(value) {
  const normalised = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
  if (normalised === "perkg") return { dimension: "mass", amount: 1000 };

  const match =
    normalised.match(/^(?:(\d+)x)?(\d+(?:\.\d+)?)(kg|g|l|ml)$/) ||
    normalised.match(/^\d+pack·(\d+(?:\.\d+)?)(kg|g|l|ml)$/);
  if (!match) return null;
  const isPackTotal = normalised.includes("pack·");
  const count = isPackTotal ? 1 : Number(match[1] || 1);
  const amountIndex = isPackTotal ? 1 : 2;
  const unitIndex = isPackTotal ? 2 : 3;
  const amount = count * Number(match[amountIndex]);
  const unit = match[unitIndex];
  if (unit === "kg") return { dimension: "mass", amount: amount * 1000 };
  if (unit === "g") return { dimension: "mass", amount };
  if (unit === "l") return { dimension: "volume", amount: amount * 1000 };
  return { dimension: "volume", amount };
}

function unitPriceRate(value) {
  const match = String(value || "").match(/\$\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)?\s*(kg|g|l|ml)\b/i);
  if (!match) return null;
  const price = Number(match[1]);
  const quantity = Number(match[2] || 1);
  const unit = match[3].toLowerCase();
  const measure =
    unit === "kg" ? quantity * 1000 : unit === "l" ? quantity * 1000 : quantity;
  return {
    dimension: unit === "kg" || unit === "g" ? "mass" : "volume",
    pricePerBaseUnit: price / measure,
  };
}

function priceMismatch(product) {
  const size = comparableSize(product.size);
  const rate = unitPriceRate(product.unitPrice);
  if (!size || !rate || size.dimension !== rate.dimension) return null;

  const expected = size.amount * rate.pricePerBaseUnit;
  const actual = Number(product.current);
  const difference = Math.abs(actual - expected);
  const tolerance = Math.max(0.15, actual * 0.03);
  if (!Number.isFinite(actual) || difference <= tolerance) return null;
  return {
    stockcode: product.stockcode,
    name: product.name,
    size: product.size,
    price: actual,
    unitPrice: product.unitPrice,
    expected: Number(expected.toFixed(2)),
    difference: Number(difference.toFixed(2)),
  };
}

function auditProducts(products) {
  const groups = new Map();
  products.forEach((product) => {
    const key = `${String(product.name).toLowerCase()}|${String(product.size).toLowerCase()}`;
    const group = groups.get(key) || [];
    group.push(product);
    groups.set(key, group);
  });

  return {
    products: products.length,
    missingSize: products.filter((product) => !product.size).map((product) => product.stockcode),
    missingImage: products.filter((product) => !product.imageUrl).map((product) => product.stockcode),
    sameNameAndSize: [...groups.values()]
      .filter((group) => group.length > 1)
      .map((group) => ({
        name: group[0].name,
        size: group[0].size,
        stockcodes: group.map((product) => product.stockcode),
        prices: group.map((product) => product.current),
      })),
    unitPriceMismatches: products.map(priceMismatch).filter(Boolean),
  };
}

function main() {
  console.log(JSON.stringify(auditProducts(listProducts()), null, 2));
}

if (require.main === module) main();

module.exports = {
  auditProducts,
  comparableSize,
  priceMismatch,
  unitPriceRate,
};
