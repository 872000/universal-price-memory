#!/usr/bin/env node

const { all, quote, run } = require("../lib/db");
const { sizeFromApiProduct } = require("./collect-woolworths-prices");

function sizeFromRawJson(rawJson) {
  try {
    const raw = JSON.parse(rawJson);
    return sizeFromApiProduct(raw.product || raw);
  } catch {
    return null;
  }
}

const rows = all(`
  select
    p.id,
    p.size,
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

const resolvedRows = rows.map((row) => ({
  id: row.id,
  previous: row.size,
  size: sizeFromRawJson(row.rawJson),
}));
const updates = resolvedRows.filter((row) => row.size && row.size !== row.previous);

if (updates.length) {
  run(`
    begin;
    ${updates.map((row) => `update products set size = ${quote(row.size)} where id = ${quote(row.id)};`).join("\n")}
    commit;
  `);
}

console.log(
  JSON.stringify(
    {
      productsChecked: rows.length,
      sizesUpdated: updates.length,
      unresolved: resolvedRows.filter((row) => !row.size).length,
    },
    null,
    2
  )
);
