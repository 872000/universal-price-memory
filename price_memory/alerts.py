"""Alert rules over the universal price history.

Rule kinds:
  below_price   trigger when the latest price is at or below `threshold`
  historic_low  trigger when the latest price is the window low (`threshold`
                unused; kept for a uniform shape)
  drop_pct      trigger when the latest price has fallen at least `threshold`
                percent below the recent median (default 30-day median)

Rules persist in the store's upm_alert_rules table so they survive restarts.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass

from .store import PriceMemoryStore, utcnow_iso

RULE_KINDS = ("below_price", "historic_low", "drop_pct")


@dataclass
class AlertRule:
    retailer: str
    product_id: str
    kind: str
    threshold: float | None = None
    id: int | None = None

    def __post_init__(self):
        if self.kind not in RULE_KINDS:
            raise ValueError(f"kind must be one of {RULE_KINDS}, got {self.kind!r}")
        if self.kind in ("below_price", "drop_pct"):
            if self.threshold is None or float(self.threshold) <= 0:
                raise ValueError(f"{self.kind} requires a positive threshold")
            self.threshold = float(self.threshold)


def add_rule(store: PriceMemoryStore, rule: AlertRule) -> int:
    """Persist an alert rule; returns its id."""
    with store._connect() as conn:
        cursor = conn.execute(
            """
            insert into upm_alert_rules (retailer, product_id, kind, threshold, created_at)
            values (?, ?, ?, ?, ?)
            """,
            (rule.retailer, rule.product_id, rule.kind, rule.threshold, utcnow_iso()),
        )
        return int(cursor.lastrowid)


def list_rules(store: PriceMemoryStore) -> list[AlertRule]:
    with store._connect() as conn:
        return [
            AlertRule(
                retailer=row["retailer"],
                product_id=row["product_id"],
                kind=row["kind"],
                threshold=row["threshold"],
                id=row["id"],
            )
            for row in conn.execute(
                "select id, retailer, product_id, kind, threshold from upm_alert_rules order by id"
            ).fetchall()
        ]


def remove_rule(store: PriceMemoryStore, rule_id: int) -> bool:
    with store._connect() as conn:
        cursor = conn.execute("delete from upm_alert_rules where id = ?", (rule_id,))
        return cursor.rowcount > 0


def _latest_and_history(store: PriceMemoryStore, retailer: str, product_id: str, window_days: int):
    latest = store.latest_price(retailer, product_id)
    history = store.get_history(retailer, product_id, days=window_days) if latest else []
    prices = [h["price"] for h in history]
    return latest, prices


def _evaluate(rule: AlertRule, latest: dict | None, prices: list[float]) -> dict | None:
    if not latest or not prices:
        return None
    current = latest["price"]
    name = latest.get("name") or rule.product_id
    base = {
        "rule_id": rule.id,
        "retailer": rule.retailer,
        "product_id": rule.product_id,
        "name": name,
        "kind": rule.kind,
        "threshold": rule.threshold,
        "current_price": current,
        "currency": latest.get("currency") or "NZD",
        "triggered_at": utcnow_iso(),
    }

    if rule.kind == "below_price":
        if current <= rule.threshold:  # type: ignore[operator]
            return {**base, "detail": f"{name} is ${current:.2f} — at/below your ${rule.threshold:.2f} target."}
    elif rule.kind == "historic_low":
        if current <= min(prices) and len(prices) >= 5:
            return {**base, "detail": f"{name} is ${current:.2f} — the lowest in the window ({len(prices)} observations)."}
    elif rule.kind == "drop_pct":
        median = statistics.median(prices)
        if median > 0:
            drop = 100.0 * (median - current) / median
            if drop >= rule.threshold:  # type: ignore[operator]
                return {
                    **base,
                    "detail": f"{name} dropped {drop:.0f}% vs the recent median (${median:.2f}) — now ${current:.2f}.",
                }
    return None


def check_alerts(store: PriceMemoryStore, window_days: int = 90) -> list[dict]:
    """Evaluate every stored rule; return the triggered alerts."""
    triggered: list[dict] = []
    for rule in list_rules(store):
        latest, prices = _latest_and_history(store, rule.retailer, rule.product_id, window_days)
        alert = _evaluate(rule, latest, prices)
        if alert:
            triggered.append(alert)
    return triggered


def detect_historic_lows(store: PriceMemoryStore, window_days: int = 90) -> list[dict]:
    """Products currently sitting at (or below) their window low — no rule needed."""
    lows: list[dict] = []
    for product in store.list_products():
        retailer, product_id = product["retailer"], product["product_id"]
        latest, prices = _latest_and_history(store, retailer, product_id, window_days)
        if latest and len(prices) >= 5 and latest["price"] <= min(prices):
            lows.append(
                {
                    "retailer": retailer,
                    "product_id": product_id,
                    "name": product["name"],
                    "current_price": latest["price"],
                    "currency": latest.get("currency") or "NZD",
                    "window_low": min(prices),
                    "observations": len(prices),
                    "detail": f"{product['name']} at ${latest['price']:.2f} — lowest in {window_days} days.",
                }
            )
    return lows
