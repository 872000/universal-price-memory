"""Sale-quality scoring: is this sale genuinely good?

The core purchasing-intelligence question the original Woolworths tracker
asked by hand — "the same product could look like a good deal one week and
return at a similar price later" — answered from price history.

A score compares the current price against the recent history window
(default 90 days):

  percentile  = % of historical observations priced at or above the current
                price. 100  -> current price beats everything on record.
                0    -> current price is the most expensive on record.

Labels:
  historic-low  current price is the lowest on record (needs >= 5 samples)
  great-deal    percentile >= 90
  good-deal     percentile >= 75
  fair          percentile >= 40
  poor          below that — the "sale" is not really a sale
  insufficient-data  fewer than 3 historical observations
"""

from __future__ import annotations

import statistics
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone

LABELS = (
    "historic-low",
    "great-deal",
    "good-deal",
    "fair",
    "poor",
    "insufficient-data",
)

MIN_SAMPLES = 3


@dataclass
class SaleScore:
    current_price: float
    currency: str
    sample_size: int
    window_days: int
    min_price: float | None
    max_price: float | None
    median_price: float | None
    mean_price: float | None
    p10_price: float | None
    percentile: float | None  # higher = better deal
    vs_median_pct: float | None  # negative = cheaper than median
    is_historic_low: bool
    label: str
    verdict: str

    def to_dict(self) -> dict:
        return asdict(self)


def _parse_ts(value) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        ts = value
    else:
        text = str(value).strip()
        try:
            ts = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            return None
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return ts


def _history_prices(history, window_days: int, now: datetime | None) -> list[float]:
    """Normalise history entries to a list of prices inside the window.

    Accepts floats, (price, timestamp) tuples, or dicts with
    price/captured_at keys (as returned by PriceMemoryStore.get_history).
    Entries without a parseable timestamp are kept (no window filtering).
    """
    now = now or datetime.now(timezone.utc)
    cutoff = now - timedelta(days=window_days)
    prices: list[float] = []
    for entry in history:
        price: float | None = None
        ts = None
        if isinstance(entry, dict):
            price = entry.get("price")
            ts = _parse_ts(entry.get("captured_at"))
        elif isinstance(entry, (tuple, list)) and len(entry) == 2:
            price, ts = entry[0], _parse_ts(entry[1])
        else:
            price = entry
        try:
            price = float(price)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            continue
        if ts is not None and ts < cutoff:
            continue
        prices.append(price)
    return prices


def _percentile(sorted_values: list[float], fraction: float) -> float:
    """Linear-interpolation percentile of a sorted list."""
    if not sorted_values:
        raise ValueError("empty list")
    if len(sorted_values) == 1:
        return sorted_values[0]
    rank = fraction * (len(sorted_values) - 1)
    low = int(rank)
    high = min(low + 1, len(sorted_values) - 1)
    weight = rank - low
    return sorted_values[low] * (1 - weight) + sorted_values[high] * weight


def score_sale(
    history,
    current_price: float,
    currency: str = "NZD",
    window_days: int = 90,
    now: datetime | None = None,
) -> SaleScore:
    """Score the current price against recent history."""
    current_price = float(current_price)
    prices = _history_prices(history, window_days, now)
    n = len(prices)

    if n < MIN_SAMPLES:
        return SaleScore(
            current_price=current_price,
            currency=currency,
            sample_size=n,
            window_days=window_days,
            min_price=min(prices) if prices else None,
            max_price=max(prices) if prices else None,
            median_price=statistics.median(prices) if prices else None,
            mean_price=statistics.fmean(prices) if prices else None,
            p10_price=None,
            percentile=None,
            vs_median_pct=None,
            is_historic_low=False,
            label="insufficient-data",
            verdict=(
                f"Only {n} price observation(s) on record — not enough history "
                "to judge this price. Keep collecting."
            ),
        )

    ordered = sorted(prices)
    minimum = ordered[0]
    maximum = ordered[-1]
    median = statistics.median(ordered)
    mean = statistics.fmean(ordered)
    p10 = _percentile(ordered, 0.10)

    at_or_above = sum(1 for p in prices if p >= current_price)
    percentile = 100.0 * at_or_above / n
    vs_median_pct = 100.0 * (current_price - median) / median if median else 0.0
    is_historic_low = current_price <= minimum and n >= 5

    if is_historic_low:
        label = "historic-low"
        verdict = (
            f"${current_price:.2f} is the lowest price seen in the last "
            f"{window_days} days ({n} observations) — buy if you need it."
        )
    elif percentile >= 90:
        label = "great-deal"
        verdict = (
            f"${current_price:.2f} beats {percentile:.0f}% of recent prices "
            f"(median ${median:.2f}) — a genuinely good price."
        )
    elif percentile >= 75:
        label = "good-deal"
        verdict = (
            f"${current_price:.2f} is cheaper than {percentile:.0f}% of recent "
            f"prices (median ${median:.2f}) — a solid deal."
        )
    elif percentile >= 40:
        label = "fair"
        verdict = (
            f"${current_price:.2f} sits near the middle of recent prices "
            f"(median ${median:.2f}) — not a standout sale."
        )
    else:
        label = "poor"
        verdict = (
            f"${current_price:.2f} is more expensive than {100 - percentile:.0f}% "
            f"of recent prices (median ${median:.2f}) — this 'sale' is not "
            "really a sale. Wait."
        )

    return SaleScore(
        current_price=current_price,
        currency=currency,
        sample_size=n,
        window_days=window_days,
        min_price=minimum,
        max_price=maximum,
        median_price=median,
        mean_price=mean,
        p10_price=p10,
        percentile=round(percentile, 1),
        vs_median_pct=round(vs_median_pct, 1),
        is_historic_low=is_historic_low,
        label=label,
        verdict=verdict,
    )


def is_genuine_sale(
    history,
    current_price: float,
    claimed_was_price: float | None = None,
    currency: str = "NZD",
    window_days: int = 90,
) -> dict:
    """Answer "is this sale genuinely good?" with evidence.

    Also sanity-checks a claimed "was $X" price: if the claimed was-price
    never actually appeared in history, the discount is treated as suspect.
    """
    score = score_sale(history, current_price, currency, window_days)
    genuine = score.label in ("historic-low", "great-deal", "good-deal")
    reasons = [score.verdict]
    was_price_suspicious = False

    if claimed_was_price is not None:
        claimed = float(claimed_was_price)
        prices = _history_prices(history, window_days, None)
        seen_near_claimed = any(p >= claimed * 0.98 for p in prices)
        if not seen_near_claimed and prices:
            was_price_suspicious = True
            reasons.append(
                f"The claimed was-price ${claimed:.2f} never appeared in the "
                f"last {window_days} days (max seen ${max(prices):.2f}) — "
                "treat the advertised discount with skepticism."
            )
        if score.median_price:
            real_discount = 100.0 * (score.median_price - score.current_price) / score.median_price
            reasons.append(
                f"Against the typical price (${score.median_price:.2f}) the real "
                f"discount is {real_discount:.0f}%, regardless of the sticker."
            )

    return {
        "genuine": genuine,
        "label": score.label,
        "score": score.to_dict(),
        "was_price_suspicious": was_price_suspicious,
        "reasons": reasons,
    }
