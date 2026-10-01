const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const dataDir = path.join(rootDir, "data");
const dbPath = process.env.PRICE_TRACKER_DB || path.join(dataDir, "price-tracker.sqlite");
const schemaPath = path.join(dataDir, "schema.sql");
const sqliteMaxBuffer = 64 * 1024 * 1024;
const sqliteOptions = {
  encoding: "utf8",
  maxBuffer: sqliteMaxBuffer,
  stdio: ["ignore", "pipe", "pipe"],
};
let databaseReady = false;

function ensureDatabase() {
  if (databaseReady) return;
  fs.mkdirSync(dataDir, { recursive: true });
  execFileSync("sqlite3", [dbPath], {
    ...sqliteOptions,
    stdio: ["pipe", "pipe", "pipe"],
    input: fs.readFileSync(schemaPath, "utf8"),
  });
  const snapshotColumns = JSON.parse(
    execFileSync("sqlite3", ["-json", dbPath, "pragma table_info(price_snapshots)"], sqliteOptions) || "[]"
  );
  if (!snapshotColumns.some((column) => column.name === "availability_status")) {
    execFileSync("sqlite3", [dbPath, "alter table price_snapshots add column availability_status text"], sqliteOptions);
  }
  databaseReady = true;
}

function quote(value) {
  if (value === null || value === undefined || value === "") return "null";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "null";
    return String(value);
  }
  if (typeof value === "boolean") return value ? "1" : "0";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function run(sql) {
  ensureDatabase();
  execFileSync("sqlite3", [dbPath, sql], sqliteOptions);
}

function all(sql) {
  ensureDatabase();
  const output = execFileSync("sqlite3", ["-json", dbPath, sql], {
    ...sqliteOptions,
  }).trim();
  return output ? JSON.parse(output) : [];
}

function get(sql) {
  return all(sql)[0] || null;
}

function slugify(value) {
  return String(value || "product")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function upsertStore(store) {
  const id = store.id || "online";
  run(upsertStoreSql(store, id));
  return id;
}

function upsertStoreSql(store, id = store.id || "online") {
  return `
    insert into stores (id, name, region, source)
    values (${quote(id)}, ${quote(store.name || "Woolworths NZ Online")}, ${quote(store.region)}, 'woolworths_nz')
    on conflict(id) do update set
      name = excluded.name,
      region = excluded.region
  `;
}

function upsertProduct(product) {
  const id = product.id || (product.stockcode ? `ww-${product.stockcode}` : slugify(product.name));
  run(upsertProductSql(product, id));
  return id;
}

function upsertProductSql(product, id) {
  return `
    insert into products (id, stockcode, source_url, name, brand, category, size, image_url)
    values (
      ${quote(id)},
      ${quote(product.stockcode)},
      ${quote(product.sourceUrl)},
      ${quote(product.name)},
      ${quote(product.brand)},
      ${quote(product.category)},
      ${quote(product.size)},
      ${quote(product.imageUrl)}
    )
    on conflict(id) do update set
      stockcode = coalesce(excluded.stockcode, products.stockcode),
      source_url = coalesce(excluded.source_url, products.source_url),
      name = excluded.name,
      brand = coalesce(excluded.brand, products.brand),
      category = coalesce(excluded.category, products.category),
      size = coalesce(excluded.size, products.size),
      image_url = coalesce(excluded.image_url, products.image_url),
      updated_at = datetime('now')
  `;
}

function insertPriceSnapshot(snapshot) {
  run(insertPriceSnapshotSql(snapshot));
}

function insertPriceSnapshotSql(snapshot) {
  return `
    insert into price_snapshots (
      product_id,
      store_id,
      price,
      original_price,
      unit_price,
      promo_text,
      availability_status,
      currency,
      source,
      raw_json,
      captured_at
    )
    values (
      ${quote(snapshot.productId)},
      ${quote(snapshot.storeId)},
      ${quote(snapshot.price)},
      ${quote(snapshot.originalPrice)},
      ${quote(snapshot.unitPrice)},
      ${quote(snapshot.promoText)},
      ${quote(snapshot.availabilityStatus)},
      ${quote(snapshot.currency || "NZD")},
      ${quote(snapshot.source || "woolworths_nz")},
      ${quote(snapshot.rawJson)},
      ${quote(snapshot.capturedAt)}
    )
  `;
}

function saveCollectedProduct({ product, store, snapshot }) {
  const productId = product.id || (product.stockcode ? `ww-${product.stockcode}` : slugify(product.name));
  const storeId = store.id || "online";
  const completeSnapshot = { ...snapshot, productId, storeId };

  run(`
    begin immediate;
    ${upsertStoreSql(store, storeId)};
    ${upsertProductSql(product, productId)};
    ${insertPriceSnapshotSql(completeSnapshot)};
    commit;
  `);

  return { productId, storeId };
}

function listProducts() {
  return all(`
    select
      p.id,
      p.stockcode,
      p.source_url as sourceUrl,
      p.name,
      p.brand,
      p.category,
      p.size,
      p.image_url as imageUrl,
      latest.price as current,
      latest.original_price as originalPrice,
      latest.unit_price as unitPrice,
      latest.promo_text as promo,
      coalesce(
        latest.availability_status,
        json_extract(latest.raw_json, '$.product.availabilityStatus')
      ) as availabilityStatus,
      latest.captured_at as capturedAt
    from products p
    left join price_snapshots latest
      on latest.id = (
        select ps.id
        from price_snapshots ps
        where ps.product_id = p.id
        order by datetime(ps.captured_at) desc, ps.id desc
        limit 1
      )
    order by p.name collate nocase
  `);
}

function getProductHistory(productId) {
  const product = get(`
    select
      id,
      stockcode,
      source_url as sourceUrl,
      name,
      brand,
      category,
      size,
      image_url as imageUrl
    from products
    where id = ${quote(productId)} or stockcode = ${quote(productId)}
    limit 1
  `);

  if (!product) return null;

  const snapshots = all(`
    select
      ps.price,
      ps.original_price as originalPrice,
      ps.unit_price as unitPrice,
      ps.promo_text as promoText,
      coalesce(
        ps.availability_status,
        json_extract(ps.raw_json, '$.product.availabilityStatus')
      ) as availabilityStatus,
      ps.currency,
      ps.captured_at as capturedAt,
      s.id as storeId,
      s.name as storeName,
      s.region as storeRegion
    from price_snapshots ps
    left join stores s on s.id = ps.store_id
    where ps.product_id = ${quote(product.id)}
    order by datetime(ps.captured_at), ps.id
  `);

  return { product, snapshots };
}

module.exports = {
  all,
  dbPath,
  ensureDatabase,
  getProductHistory,
  insertPriceSnapshot,
  listProducts,
  quote,
  run,
  saveCollectedProduct,
  upsertProduct,
  upsertStore,
};
