#!/usr/bin/env python3
"""Universal Price Memory CLI.

Examples:
    python3 -m price_memory.cli init
    python3 -m price_memory.cli record --retailer woolworths-nz \\
        --product-id 123456 --name "Milk 2L" --price 4.20 --currency NZD
    python3 -m price_memory.cli score --retailer woolworths-nz --product-id 123456
    python3 -m price_memory.cli alerts
    python3 -m price_memory.cli import-capture --file captures.jsonl
    python3 -m price_memory.cli demo
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
from datetime import datetime, timedelta, timezone

from .alerts import AlertRule, add_rule, check_alerts, detect_historic_lows, list_rules
from .capture import import_capture
from .scoring import is_genuine_sale, score_sale
from .store import PriceMemoryStore


def default_db_path() -> str:
    if os.environ.get("UPM_DB"):
        return os.environ["UPM_DB"]
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(here, "data", "universal-price-memory.sqlite")


def get_store(path: str | None) -> PriceMemoryStore:
    store = PriceMemoryStore(path or default_db_path())
    store.init()
    return store


def cmd_init(args) -> int:
    store = get_store(args.db)
    print(f"initialized {store.path}")
    return 0


def cmd_record(args) -> int:
    store = get_store(args.db)
    sid = store.record_snapshot(
        retailer=args.retailer,
        product_id=args.product_id,
        name=args.name,
        price=args.price,
        currency=args.currency,
        url=args.url,
        brand=args.brand,
        source=args.source,
    )
    print(f"recorded snapshot #{sid}")
    return 0


def cmd_score(args) -> int:
    store = get_store(args.db)
    latest = store.latest_price(args.retailer, args.product_id)
    if not latest:
        print("no observations for that product", file=sys.stderr)
        return 1
    history = store.get_history(args.retailer, args.product_id, days=args.window_days)
    if args.was_price is not None:
        result = is_genuine_sale(
            history, latest["price"], claimed_was_price=args.was_price,
            currency=latest.get("currency") or "NZD", window_days=args.window_days,
        )
        print(json.dumps(result, indent=2, default=str))
    else:
        score = score_sale(history, latest["price"], latest.get("currency") or "NZD", args.window_days)
        print(json.dumps(score.to_dict(), indent=2, default=str))
    return 0


def cmd_add_rule(args) -> int:
    store = get_store(args.db)
    rule = AlertRule(
        retailer=args.retailer, product_id=args.product_id,
        kind=args.kind, threshold=args.threshold,
    )
    rid = add_rule(store, rule)
    print(f"added rule #{rid} ({rule.kind})")
    return 0


def cmd_list_rules(args) -> int:
    store = get_store(args.db)
    for rule in list_rules(store):
        print(f"#{rule.id} {rule.retailer}/{rule.product_id} {rule.kind} threshold={rule.threshold}")
    return 0


def cmd_alerts(args) -> int:
    store = get_store(args.db)
    triggered = check_alerts(store, window_days=args.window_days)
    lows = detect_historic_lows(store, window_days=args.window_days)
    if not triggered and not lows:
        print("no alerts — nothing at or below your targets right now.")
        return 0
    for alert in triggered:
        print(f"[RULE #{alert['rule_id']}] {alert['detail']}")
    seen = {(a["retailer"], a["product_id"]) for a in triggered}
    for low in lows:
        if (low["retailer"], low["product_id"]) not in seen:
            print(f"[HISTORIC LOW] {low['detail']}")
    return 0


def cmd_import_capture(args) -> int:
    store = get_store(args.db)
    with open(args.file, encoding="utf-8") as fh:
        result = import_capture(store, fh)
    print(f"imported={result.imported} skipped={result.skipped}")
    for err in result.errors[:10]:
        print(f"  ! {err}", file=sys.stderr)
    return 0 if result.skipped == 0 else 2


def cmd_demo(args) -> int:
    """Seed deterministic multi-retailer data and show scoring + alerts."""
    store = get_store(args.db)
    rng = random.Random(42)
    now = datetime.now(timezone.utc)
    products = [
        ("woolworths-nz", "111", "Milk 2L", "NZD", 4.20),
        ("woolworths-nz", "222", "Toilet Paper 12 Pack", "NZD", 9.50),
        ("amazon-ca", "B0001", "AA Batteries 24 Pack", "CAD", 14.99),
    ]
    for retailer, pid, name, currency, base in products:
        for day in range(120, 0, -1):
            price = round(base * rng.uniform(0.85, 1.25), 2)
            # a promo dip ~10 days ago, and one product currently at its low
            if day == 10:
                price = round(base * 0.78, 2)
            if pid == "111" and day == 1:
                price = round(base * 0.75, 2)
            ts = (now - timedelta(days=day)).isoformat().replace("+00:00", "Z")
            store.record_snapshot(retailer, pid, name, price, currency,
                                  captured_at=ts, source="demo")
    add_rule(store, AlertRule("woolworths-nz", "111", "below_price", 3.60))
    add_rule(store, AlertRule("amazon-ca", "B0001", "drop_pct", 15.0))

    print("== sale scores ==")
    for retailer, pid, name, currency, _ in products:
        latest = store.latest_price(retailer, pid)
        history = store.get_history(retailer, pid, days=90)
        score = score_sale(history, latest["price"], currency, 90)
        print(f"- {name}: ${latest['price']:.2f} -> {score.label}: {score.verdict}")
    print("\n== alerts ==")
    return cmd_alerts(args)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="price-memory", description="Universal Price Memory")
    parser.add_argument("--db", default=None, help="SQLite path (or set UPM_DB)")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("init", help="create the database")

    p = sub.add_parser("record", help="record one price observation")
    p.add_argument("--retailer", required=True)
    p.add_argument("--product-id", required=True)
    p.add_argument("--name", required=True)
    p.add_argument("--price", required=True, type=float)
    p.add_argument("--currency", default="NZD")
    p.add_argument("--url", default=None)
    p.add_argument("--brand", default=None)
    p.add_argument("--source", default="manual")

    p = sub.add_parser("score", help="judge the current price from history")
    p.add_argument("--retailer", required=True)
    p.add_argument("--product-id", required=True)
    p.add_argument("--window-days", type=int, default=90)
    p.add_argument("--was-price", type=float, default=None,
                   help="advertised 'was' price to sanity-check")

    p = sub.add_parser("add-rule", help="add an alert rule")
    p.add_argument("--retailer", required=True)
    p.add_argument("--product-id", required=True)
    p.add_argument("--kind", required=True, choices=("below_price", "historic_low", "drop_pct"))
    p.add_argument("--threshold", type=float, default=None)

    sub.add_parser("list-rules", help="list alert rules")

    p = sub.add_parser("alerts", help="check alert rules and historic lows")
    p.add_argument("--window-days", type=int, default=90)

    p = sub.add_parser("import-capture", help="import browser-capture JSONL")
    p.add_argument("--file", required=True)

    p = sub.add_parser("demo", help="seed demo data and show scores/alerts")
    p.add_argument("--window-days", type=int, default=90)
    return parser


def main(argv=None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    handlers = {
        "init": cmd_init,
        "record": cmd_record,
        "score": cmd_score,
        "add-rule": cmd_add_rule,
        "list-rules": cmd_list_rules,
        "alerts": cmd_alerts,
        "import-capture": cmd_import_capture,
        "demo": cmd_demo,
    }
    try:
        return handlers[args.command](args)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
