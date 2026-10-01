#!/usr/bin/env node

const { all, quote, run } = require("../lib/db");

function text(value) {
  if (value === null || value === undefined) return null;
  const result = String(value).replace(/\s+/g, " ").trim();
  return result && result !== "[object Object]" ? result : null;
}

function categoryName(value) {
  if (!value) return null;
  if (typeof value === "string") return text(value);
  if (typeof value === "object") return text(value.name || value.label || value.title);
  return null;
}

function categoryFromRawJson(rawJson) {
  try {
    const raw = JSON.parse(rawJson);
    const product = raw.product || raw;
    return (
      categoryName(product.breadcrumb?.department) ||
      categoryName(product.breadcrumb?.aisle) ||
      categoryName(product.category)
    );
  } catch {
    return null;
  }
}

const rows = all(`
  select
    p.id,
    p.category,
    latest.raw_json as rawJson
  from products p
  join price_snapshots latest
    on latest.id = (
      select ps.id
      from price_snapshots ps
      where ps.product_id = p.id
      order by datetime(ps.captured_at) desc, ps.id desc
      limit 1
    )
`);

const updates = rows
  .map((row) => ({ id: row.id, previous: row.category, category: categoryFromRawJson(row.rawJson) }))
  .filter((row) => row.category && row.category !== row.previous);

if (updates.length) {
  run(`
    begin;
    ${updates.map((row) => `update products set category = ${quote(row.category)} where id = ${quote(row.id)};`).join("\n")}
    commit;
  `);
}

console.log(
  JSON.stringify(
    {
      productsChecked: rows.length,
      categoriesUpdated: updates.length,
      categories: Object.entries(
        updates.reduce((counts, row) => {
          counts[row.category] = (counts[row.category] || 0) + 1;
          return counts;
        }, {})
      )
        .sort((a, b) => b[1] - a[1])
        .map(([category, products]) => ({ category, products })),
    },
    null,
    2
  )
);
