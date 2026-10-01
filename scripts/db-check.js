#!/usr/bin/env node

const { all, dbPath, ensureDatabase } = require("../lib/db");

ensureDatabase();

const counts = {
  products: all("select count(*) as count from products")[0]?.count || 0,
  stores: all("select count(*) as count from stores")[0]?.count || 0,
  price_snapshots: all("select count(*) as count from price_snapshots")[0]?.count || 0,
};

const recentSnapshots = all(`
  select
    ps.id,
    ps.product_id as productId,
    p.stockcode,
    p.name,
    ps.price,
    ps.original_price as originalPrice,
    ps.unit_price as unitPrice,
    ps.promo_text as promoText,
    ps.captured_at as capturedAt,
    ps.store_id as storeId
  from price_snapshots ps
  join products p on p.id = ps.product_id
  order by datetime(ps.captured_at) desc, ps.id desc
  limit 5
`);

console.log(JSON.stringify({ database: dbPath, counts, recentSnapshots }, null, 2));
