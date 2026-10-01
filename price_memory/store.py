"""Retailer-agnostic local price-history store (SQLite, stdlib only).

Schema
------
upm_products
    (retailer, product_id) -> name, brand, url, currency, timestamps
upm_snapshots
    id -> retailer, product_id, price, currency, captured_at, source, raw_json
upm_alert_rules
    id -> retailer, product_id, kind, threshold

Data-integrity decisions (carried over from the Woolworths NZ tracker):
  * a snapshot requires retailer, product_id, name, a positive finite price
    and a currency code
  * zero, negative, NaN and non-finite prices are rejected before persistence
    (an unavailable product once returned $0.00 upstream, which would have
    created a false historical low)
  * product and snapshot writes happen in a single transaction
"""

from __future__ import annotations

import json
import math
import os
import sqlite3
from datetime import datetime, timezone

SCHEMA = """
pragma journal_mode = wal;
pragma foreign_keys = on;

create table if not exists upm_products (
  retailer   text not null,
  product_id text not null,
  name       text not null,
  brand      text,
  url        text,
  currency   text not null default 'NZD',
  created_at text not null,
  updated_at text not null,
  primary key (retailer, product_id)
);

create table if not exists upm_snapshots (
  id          integer primary key autoincrement,
  retailer    text not null,
  product_id  text not null,
  price       real not null,
  currency    text not null,
  captured_at text not null,
  source      text not null default 'manual',
  raw_json    text,
  foreign key (retailer, product_id)
    references upm_products (retailer, product_id) on delete cascade
);

create index if not exists idx_upm_snapshots_lookup
  on upm_snapshots (retailer, product_id, captured_at);

create table if not exists upm_alert_rules (
  id         integer primary key autoincrement,
  retailer   text not null,
  product_id text not null,
  kind       text not null,
  threshold  real,
  created_at text not null
);
"""


def utcnow_iso() -> str:
    """Current UTC time as an ISO-8601 string with a Z suffix."""
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def validate_price(price: float) -> float:
    """Reject anything that is not a positive, finite price."""
    if isinstance(price, bool) or not isinstance(price, (int, float)):
        raise ValueError(f"price must be a number, got {price!r}")
    price = float(price)
    if not math.isfinite(price) or price <= 0:
        raise ValueError(f"price must be positive and finite, got {price!r}")
    return price


def _require(value: str | None, field: str) -> str:
    if value is None or str(value).strip() == "":
        raise ValueError(f"{field} is required")
    return str(value).strip()


class PriceMemoryStore:
    """Local SQLite store for price observations from any retailer."""

    def __init__(self, path: str):
        self.path = os.path.abspath(path)

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        conn.execute("pragma foreign_keys = on")
        return conn

    def init(self) -> None:
        """Create tables/indexes if they do not exist."""
        os.makedirs(os.path.dirname(self.path) or ".", exist_ok=True)
        with self._connect() as conn:
            conn.executescript(SCHEMA)

    def record_snapshot(
        self,
        retailer: str,
        product_id: str,
        name: str,
        price: float,
        currency: str = "NZD",
        captured_at: str | None = None,
        url: str | None = None,
        brand: str | None = None,
        source: str = "manual",
        raw: dict | None = None,
    ) -> int:
        """Record one price observation; returns the snapshot row id."""
        retailer = _require(retailer, "retailer")
        product_id = _require(product_id, "product_id")
        name = _require(name, "name")
        currency = _require(currency, "currency").upper()
        price = validate_price(price)
        captured_at = captured_at or utcnow_iso()
        raw_json = json.dumps(raw) if raw is not None else None

        with self._connect() as conn:
            conn.execute(
                """
                insert into upm_products
                    (retailer, product_id, name, brand, url, currency, created_at, updated_at)
                values (?, ?, ?, ?, ?, ?, ?, ?)
                on conflict (retailer, product_id) do update set
                    name = excluded.name,
                    brand = excluded.brand,
                    url = excluded.url,
                    currency = excluded.currency,
                    updated_at = excluded.updated_at
                """,
                (retailer, product_id, name, brand, url, currency, captured_at, captured_at),
            )
            cursor = conn.execute(
                """
                insert into upm_snapshots
                    (retailer, product_id, price, currency, captured_at, source, raw_json)
                values (?, ?, ?, ?, ?, ?, ?)
                """,
                (retailer, product_id, price, currency, captured_at, source, raw_json),
            )
            return int(cursor.lastrowid)

    def get_history(
        self,
        retailer: str,
        product_id: str,
        days: int | None = None,
        limit: int | None = None,
        now: str | None = None,
    ) -> list[dict]:
        """Price observations oldest-first, optionally restricted to a window."""
        sql = """
            select price, currency, captured_at, source
            from upm_snapshots
            where retailer = ? and product_id = ?
        """
        params: list = [retailer, product_id]
        if days is not None:
            sql += " and captured_at >= datetime(?, ?)"
            params += [now or utcnow_iso(), f"-{int(days)} days"]
        sql += " order by captured_at asc"
        if limit is not None:
            sql += " limit ?"
            params.append(int(limit))
        with self._connect() as conn:
            return [dict(row) for row in conn.execute(sql, params).fetchall()]

    def latest_price(self, retailer: str, product_id: str) -> dict | None:
        """Most recent observation for a product, or None."""
        with self._connect() as conn:
            row = conn.execute(
                """
                select s.price, s.currency, s.captured_at, s.source, p.name, p.url, p.brand
                from upm_snapshots s
                join upm_products p
                  on p.retailer = s.retailer and p.product_id = s.product_id
                where s.retailer = ? and s.product_id = ?
                order by s.captured_at desc
                limit 1
                """,
                (retailer, product_id),
            ).fetchone()
            return dict(row) if row else None

    def list_products(self) -> list[dict]:
        """Every known product with its latest observed price."""
        with self._connect() as conn:
            return [
                dict(row)
                for row in conn.execute(
                    """
                    select p.retailer, p.product_id, p.name, p.brand, p.url, p.currency,
                           (select s.price from upm_snapshots s
                             where s.retailer = p.retailer and s.product_id = p.product_id
                             order by s.captured_at desc limit 1) as latest_price,
                           (select s.captured_at from upm_snapshots s
                             where s.retailer = p.retailer and s.product_id = p.product_id
                             order by s.captured_at desc limit 1) as latest_at,
                           (select count(*) from upm_snapshots s
                             where s.retailer = p.retailer and s.product_id = p.product_id)
                             as observation_count
                    from upm_products p
                    order by p.retailer, p.name
                    """
                ).fetchall()
            ]

    def export_jsonl(self, dest_path: str) -> int:
        """Dump every snapshot as JSON lines (portable backup / sharing)."""
        count = 0
        with self._connect() as conn, open(dest_path, "w", encoding="utf-8") as fh:
            for row in conn.execute(
                """
                select s.retailer, s.product_id, p.name, p.brand, p.url,
                       s.price, s.currency, s.captured_at, s.source
                from upm_snapshots s
                join upm_products p
                  on p.retailer = s.retailer and p.product_id = s.product_id
                order by s.captured_at asc
                """
            ):
                fh.write(json.dumps(dict(row)) + "\n")
                count += 1
        return count
