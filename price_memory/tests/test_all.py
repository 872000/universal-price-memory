"""Sanity tests for Universal Price Memory (stdlib only).

Run:  python3 -m price_memory.tests.test_all   (from the repo root)
"""

import os
import tempfile

from price_memory.alerts import AlertRule, add_rule, check_alerts, detect_historic_lows
from price_memory.capture import CaptureError, import_capture, parse_capture_line
from price_memory.scoring import is_genuine_sale, score_sale
from price_memory.store import PriceMemoryStore, utcnow_iso


def make_store():
    fd, path = tempfile.mkstemp(suffix=".sqlite")
    os.close(fd)
    os.unlink(path)
    store = PriceMemoryStore(path)
    store.init()
    return store


def seed(store, retailer="woolworths-nz", pid="123", prices=(5.0, 5.0, 4.5, 5.5, 4.0)):
    for i, price in enumerate(prices):
        store.record_snapshot(
            retailer, pid, "Test Product", price, "NZD",
            captured_at=f"2026-06-{10 + i:02d}T12:00:00Z", source="test",
        )


def test_store_validation():
    store = make_store()
    for bad in (0, -1.5, float("nan"), float("inf"), "abc", None):
        try:
            store.record_snapshot("r", "p", "n", bad)
        except (ValueError, TypeError):
            pass
        else:
            raise AssertionError(f"bad price accepted: {bad!r}")
    for missing in (("", "p", "n"), ("r", "", "n"), ("r", "p", "")):
        try:
            store.record_snapshot(missing[0], missing[1], missing[2], 1.0)
        except ValueError:
            pass
        else:
            raise AssertionError(f"missing field accepted: {missing!r}")


def test_store_roundtrip():
    store = make_store()
    seed(store)
    history = store.get_history("woolworths-nz", "123")
    assert len(history) == 5, history
    assert [h["price"] for h in history] == [5.0, 5.0, 4.5, 5.5, 4.0]
    latest = store.latest_price("woolworths-nz", "123")
    assert latest["price"] == 4.0
    assert latest["name"] == "Test Product"
    products = store.list_products()
    assert len(products) == 1 and products[0]["observation_count"] == 5


def test_scoring_labels():
    history = [{"price": p, "captured_at": f"2026-08-{i + 1:02d}T12:00:00Z"}
               for i, p in enumerate([5.0] * 20 + [4.5] * 20 + [4.0] * 5)]
    low = score_sale(history, 3.9, window_days=365)
    assert low.label == "historic-low", low.label
    assert low.is_historic_low
    assert low.percentile == 100.0

    high = score_sale(history, 5.5, window_days=365)
    assert high.label == "poor", high.label
    assert high.percentile == 0.0, high.percentile

    mid = score_sale(history, 4.5, window_days=365)
    assert mid.label in ("fair", "good-deal", "great-deal"), mid.label

    few = score_sale([{"price": 5.0}], 4.0)
    assert few.label == "insufficient-data"
    assert few.percentile is None


def test_genuine_sale_was_price_check():
    history = [{"price": 10.0, "captured_at": f"2026-08-{i + 1:02d}T12:00:00Z"} for i in range(20)]
    honest = is_genuine_sale(history, 10.0, claimed_was_price=10.0)
    assert not honest["was_price_suspicious"]
    shady = is_genuine_sale(history, 9.0, claimed_was_price=25.0)
    assert shady["was_price_suspicious"], shady
    assert any("skepticism" in r for r in shady["reasons"])


def test_capture_parse_and_import():
    store = make_store()
    good = (
        '{"retailer": "amazon-ca", "product_id": "B1", "name": "Widget",'
        ' "price": 12.99, "currency": "CAD", "url": "https://example.com",'
        ' "captured_at": "2026-10-01T05:00:00Z", "source": "browser-extension"}'
    )
    parsed = parse_capture_line(good)
    assert parsed["currency"] == "CAD" and parsed["source"] == "browser-extension"

    for bad in (
        '{"retailer": "x"}',  # missing fields
        '{"retailer":"r","product_id":"p","name":"n","price":0,"currency":"NZD"}',  # bad price
        '{"retailer":"r","product_id":"p","name":"n","price":1,"currency":"NZD","zzz":1}',  # unknown field
        "not json",
    ):
        try:
            parse_capture_line(bad)
        except CaptureError:
            pass
        else:
            raise AssertionError(f"bad capture accepted: {bad}")

    lines = [good, '{"retailer": "x"}', "", good.replace("12.99", "-5")]
    result = import_capture(store, lines)
    assert result.imported == 1, result
    assert result.skipped == 2, result
    assert len(result.errors) == 2
    assert len(store.get_history("amazon-ca", "B1")) == 1


def test_alerts():
    store = make_store()
    seed(store, prices=(10.0, 10.0, 9.0, 10.0, 8.0, 7.5))
    add_rule(store, AlertRule("woolworths-nz", "123", "below_price", 8.0))
    add_rule(store, AlertRule("woolworths-nz", "123", "historic_low"))
    add_rule(store, AlertRule("woolworths-nz", "123", "drop_pct", 10.0))
    triggered = check_alerts(store, window_days=365)
    kinds = {a["kind"] for a in triggered}
    assert kinds == {"below_price", "historic_low", "drop_pct"}, kinds

    store2 = make_store()
    seed(store2, prices=(10.0, 10.0, 10.0, 10.0, 10.0))
    assert check_alerts(store2, window_days=365) == []
    lows = detect_historic_lows(store, window_days=365)
    assert any(l["product_id"] == "123" for l in lows), lows


def test_utcnow_iso():
    assert utcnow_iso().endswith("Z")


TESTS = [
    test_store_validation,
    test_store_roundtrip,
    test_scoring_labels,
    test_genuine_sale_was_price_check,
    test_capture_parse_and_import,
    test_alerts,
    test_utcnow_iso,
]


def main():
    failed = 0
    for test in TESTS:
        try:
            test()
        except Exception as exc:  # noqa: BLE001
            failed += 1
            print(f"FAIL {test.__name__}: {type(exc).__name__}: {exc}")
        else:
            print(f"ok   {test.__name__}")
    print(f"{len(TESTS) - failed}/{len(TESTS)} passed")
    raise SystemExit(1 if failed else 0)


if __name__ == "__main__":
    main()
