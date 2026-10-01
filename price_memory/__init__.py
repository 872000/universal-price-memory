"""Universal Price Memory — retailer-agnostic price history, sale scoring and alerts.

Evolved from a Woolworths NZ-specific tracker into a general layer that can
remember prices from any retailer, judge whether a "sale" is genuinely good,
and notify you when prices hit your targets.

Modules:
    price_memory.store    Local SQLite price-history store (retailer-agnostic schema)
    price_memory.scoring  Sale-quality scoring ("is this sale genuinely good?")
    price_memory.alerts   Alert rules (price drops, historic lows)
    price_memory.capture  Browser-capture JSONL import format
    price_memory.cli      Small command-line interface
"""

__version__ = "0.2.0"

from .store import PriceMemoryStore  # noqa: F401
from .scoring import SaleScore, is_genuine_sale, score_sale  # noqa: F401
from .alerts import AlertRule, add_rule, check_alerts, detect_historic_lows, list_rules  # noqa: F401
from .capture import import_capture, parse_capture_line  # noqa: F401
