# Woolworths NZ Data Integration Notes

## Scope

This app targets Woolworths New Zealand. Prices can vary by store, region, delivery address, loyalty status, and weekly promotion cycle, so every captured price should include source context.

## Suggested data model

```sql
create table products (
  id text primary key,
  woolworths_id text unique,
  barcode text,
  name text not null,
  brand text,
  category text,
  size text,
  image_url text,
  created_at timestamptz default now()
);

create table price_snapshots (
  id bigserial primary key,
  product_id text references products(id),
  price numeric(10, 2) not null,
  original_price numeric(10, 2),
  unit_price text,
  promo_text text,
  is_member_price boolean default false,
  store_region text,
  store_id text,
  captured_at timestamptz not null default now()
);

create table watchlist (
  id bigserial primary key,
  user_id text not null,
  product_id text references products(id),
  target_price numeric(10, 2),
  notify_on_historical_low boolean default true,
  created_at timestamptz default now()
);

create table promotions (
  id bigserial primary key,
  product_id text references products(id),
  promo_type text,
  points_bonus integer default 0,
  start_date date,
  end_date date,
  captured_at timestamptz default now()
);
```

## Capture strategy

- Start with a small allowlist of common products and capture once per day.
- Store raw responses or page snapshots separately for debugging.
- Respect Woolworths NZ terms, robots rules, rate limits, and caching headers.
- Keep collection frequency low unless you have an approved API or partnership.
- Treat price as scoped by region or selected store, not as a single national truth.

## Backend API shape

```text
GET /api/products
GET /api/products?query=milk&category=Dairy
GET /api/products/:id
GET /api/products/:id/prices?days=180&region=auckland
GET /api/products/:id/history
POST /api/watchlist
GET /api/watchlist
GET /api/planner?budget=80&goal=points
POST /api/ai/advice
```

The MVP currently implements:

```text
GET /api/products
GET /api/products/:id/history
```

## AI integration

The model should receive structured facts, not raw scraped HTML:

```json
{
  "shoppingList": ["milk", "bread", "cheese"],
  "priceFacts": [
    {
      "name": "Mainland Tasty Cheese 1kg",
      "currentPrice": 14.99,
      "historicalLow": 14.99,
      "average90Day": 16.58,
      "pointsBonus": 120
    }
  ],
  "userGoal": "minimise spend while collecting useful points"
}
```

Recommended first AI features:

- Explain whether to buy now or wait.
- Rank substitutions when two products serve the same need.
- Build a points campaign basket from products the user actually buys.
- Summarise weekly changes for watched products.
