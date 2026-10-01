pragma journal_mode = wal;
pragma foreign_keys = on;

create table if not exists stores (
  id text primary key,
  name text not null,
  region text,
  source text not null default 'woolworths_nz',
  created_at text not null default (datetime('now'))
);

create table if not exists products (
  id text primary key,
  stockcode text unique,
  source_url text,
  name text not null,
  brand text,
  category text,
  size text,
  image_url text,
  created_at text not null default (datetime('now')),
  updated_at text not null default (datetime('now'))
);

create table if not exists price_snapshots (
  id integer primary key autoincrement,
  product_id text not null references products(id) on delete cascade,
  store_id text references stores(id),
  price real not null,
  original_price real,
  unit_price text,
  promo_text text,
  availability_status text,
  currency text not null default 'NZD',
  source text not null default 'woolworths_nz',
  raw_json text,
  captured_at text not null default (datetime('now'))
);

create index if not exists idx_price_snapshots_product_captured
  on price_snapshots(product_id, captured_at);

create index if not exists idx_price_snapshots_store
  on price_snapshots(store_id);
