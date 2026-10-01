# Changelog

## 0.2.0 — Universal Price Memory (2026-10-01)

Generalized the Woolworths NZ-only tracker into a retailer-agnostic price
memory layer:

- Added `price_memory/store.py`: SQLite store keyed by
  `(retailer, product_id)` — name, price, currency, timestamp, brand, url —
  with positive-finite price validation and transactional writes.
- Added `price_memory/scoring.py`: 90-day sale-quality scoring
  (`historic-low` / `great-deal` / `good-deal` / `fair` / `poor` /
  `insufficient-data`) and `is_genuine_sale()` with "was-price" skepticism
  checks.
- Added `price_memory/alerts.py`: persistent `below_price`, `historic_low`
  and `drop_pct` alert rules plus automatic historic-low detection.
- Added `price_memory/capture.py`: validated JSONL browser-capture import
  format for extension-collected prices.
- Added `price_memory/cli.py`: `init`, `record`, `score`, `add-rule`,
  `list-rules`, `alerts`, `import-capture`, `demo`.
- Added `price_memory/tests/test_all.py`: 7 sanity tests, all passing.
- Original Woolworths NZ collector, PWA and API left intact.

## 0.1.0 — Woolworths NZ Price Tracker (upstream)

- Weekly discovery/collection/validation pipeline into SQLite.
- Read-only Node.js API + bilingual PWA with SVG price charts.
- Watchlists, low-price rules, audits, and demo-data fallback.
