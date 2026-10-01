"""Browser-capture import format.

A browser extension (or any scraper) can observe prices while you shop and
append one JSON object per observation to a `.jsonl` file, or POST a batch
to a collector. `import_capture` validates and stores those lines.

Line format (one JSON object per line)::

    {"retailer": "woolworths-nz",
     "product_id": "123456",
     "name": "Signature Range Toilet Paper 12 Pack",
     "price": 8.50,
     "currency": "NZD",
     "url": "https://www.woolworths.co.nz/shop/productdetails?stockcode=123456",
     "brand": "Signature Range",
     "captured_at": "2026-10-01T05:12:00Z",
     "source": "browser-extension"}

Required fields: retailer, product_id, name, price, currency.
Optional fields: url, brand, captured_at (defaults to now), source
(defaults to "browser-extension"), raw (arbitrary extra JSON to preserve).

Anything failing validation is reported, never silently stored — matching
the source project's stance that bad price data is worse than no data.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field

from .store import PriceMemoryStore, utcnow_iso, validate_price

REQUIRED_FIELDS = ("retailer", "product_id", "name", "price", "currency")
OPTIONAL_FIELDS = ("url", "brand", "captured_at", "source", "raw")

CAPTURE_FORMAT_DOC = """\
# Browser-capture format

Append one JSON object per observed price to a `.jsonl` file
(e.g. `captures.jsonl`), then import it:

    python3 -m price_memory.cli import-capture --file captures.jsonl

## Schema

| field       | required | description                                      |
|-------------|----------|--------------------------------------------------|
| retailer    | yes      | slug like `woolworths-nz`, `amazon-ca`, `loblaws`|
| product_id  | yes      | retailer-side id (stockcode, SKU, ASIN, …)        |
| name        | yes      | product display name                             |
| price       | yes      | number, positive and finite                      |
| currency    | yes      | ISO code, e.g. `NZD`, `CAD`, `USD`               |
| url         | no       | product page URL                                 |
| brand       | no       | brand name                                       |
| captured_at | no       | ISO-8601 timestamp; defaults to import time      |
| source      | no       | defaults to `browser-extension`                  |
| raw         | no       | extra JSON preserved verbatim                    |

## Example line

```json
{"retailer": "woolworths-nz", "product_id": "123456", "name": "Milk 2L",
 "price": 4.2, "currency": "NZD", "url": "https://example.com/p/123456",
 "captured_at": "2026-10-01T05:12:00Z", "source": "browser-extension"}
```

## Extension sketch

A minimal content script can read `document` meta / JSON-LD
(`og:price:amount`, `og:price:currency`, `og:title`), build this object,
and `fetch(collectorUrl, {method: "POST", body: JSON.stringify(obj)})`.
The collector appends each POST body as one line to the jsonl file.
"""


class CaptureError(ValueError):
    """A capture line failed validation."""


def parse_capture_line(line: str) -> dict:
    """Parse and validate one JSONL capture line; raises CaptureError."""
    try:
        obj = json.loads(line)
    except json.JSONDecodeError as exc:
        raise CaptureError(f"invalid JSON: {exc}") from exc
    if not isinstance(obj, dict):
        raise CaptureError("capture line must be a JSON object")

    missing = [f for f in REQUIRED_FIELDS if obj.get(f) in (None, "")]
    if missing:
        raise CaptureError(f"missing required fields: {', '.join(missing)}")

    for key in ("retailer", "product_id", "name", "currency"):
        if not isinstance(obj[key], str) or not obj[key].strip():
            raise CaptureError(f"{key} must be a non-empty string")
    try:
        obj["price"] = validate_price(obj["price"])
    except ValueError as exc:
        raise CaptureError(str(exc)) from exc

    unknown = sorted(set(obj) - set(REQUIRED_FIELDS) - set(OPTIONAL_FIELDS))
    if unknown:
        raise CaptureError(f"unknown fields: {', '.join(unknown)}")

    return {
        "retailer": obj["retailer"].strip(),
        "product_id": str(obj["product_id"]).strip(),
        "name": obj["name"].strip(),
        "price": obj["price"],
        "currency": obj["currency"].strip().upper(),
        "url": obj.get("url"),
        "brand": obj.get("brand"),
        "captured_at": obj.get("captured_at") or utcnow_iso(),
        "source": obj.get("source") or "browser-extension",
        "raw": obj.get("raw"),
    }


@dataclass
class ImportResult:
    imported: int = 0
    skipped: int = 0
    errors: list[str] = field(default_factory=list)


def import_capture(store: PriceMemoryStore, lines) -> ImportResult:
    """Validate and store capture lines; never raises on bad lines."""
    result = ImportResult()
    for lineno, line in enumerate(lines, start=1):
        if not line.strip():
            continue
        try:
            capture = parse_capture_line(line)
        except CaptureError as exc:
            result.skipped += 1
            result.errors.append(f"line {lineno}: {exc}")
            continue
        try:
            store.record_snapshot(**capture)
        except ValueError as exc:
            result.skipped += 1
            result.errors.append(f"line {lineno}: {exc}")
            continue
        result.imported += 1
    return result
