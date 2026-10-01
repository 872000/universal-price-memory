const nzCurrency = new Intl.NumberFormat("en-NZ", {
  style: "currency",
  currency: "NZD",
});

export function createMockProducts(mockProducts, dates) {
  return mockProducts.map((product) => ({
    ...product,
    historyDates: dates,
    source: "mock",
  }));
}

export function apiProductToView(product) {
  const current = Number(product.current);
  const category = product.category && product.category !== "[object Object]" ? product.category : "Tracked";
  return {
    id: product.id,
    stockcode: product.stockcode,
    name: product.name,
    brand: product.brand || "Woolworths NZ",
    category,
    size: product.size || product.unitPrice || "",
    icon: "🛒",
    color: "#edf4f0",
    current: Number.isFinite(current) ? current : 0,
    originalPrice:
      product.originalPrice !== null &&
      product.originalPrice !== undefined &&
      Number.isFinite(Number(product.originalPrice))
        ? Number(product.originalPrice)
        : null,
    points: 0,
    promo: product.promo || product.unitPrice || "Live snapshot",
    availabilityStatus: product.availabilityStatus || null,
    history: Number.isFinite(current) ? [current] : [0],
    historyAvailability: [product.availabilityStatus || null],
    historyDates: product.capturedAt
      ? [product.capturedAt.slice(0, 10)]
      : [new Date().toISOString().slice(0, 10)],
    imageUrl: product.imageUrl,
    source: "api",
    historyLoaded: false,
  };
}

export function priceHistory(product) {
  const history = product.history || [];
  const availability = product.historyAvailability;
  const prices = history
    .map((price, index) => ({
      price: Number(price),
      available:
        !Array.isArray(availability) ||
        availabilityKey({ availabilityStatus: availability[index] }) !== "outOfStock",
    }))
    .filter((entry) => Number.isFinite(entry.price) && entry.available)
    .map((entry) => entry.price);
  if (prices.length || Array.isArray(availability)) return prices;
  return [Number(product.current) || 0];
}

export function minPrice(product) {
  const history = priceHistory(product);
  return history.length ? Math.min(...history) : null;
}

export function average(product) {
  const history = priceHistory(product);
  return history.length ? history.reduce((total, price) => total + price, 0) / history.length : null;
}

export function previousPrice(product) {
  const history = priceHistory(product);
  return history.at(-2) ?? history.at(-1) ?? product.current;
}

export function discountRatio(product) {
  const mean = average(product);
  return mean ? (mean - product.current) / mean : 0;
}

export function isNearLow(product) {
  const low = minPrice(product);
  return isAvailable(product) && low !== null && product.current <= low * 1.03;
}

export function originalPrice(product) {
  const value = Number(product.originalPrice);
  return Number.isFinite(value) && value > product.current ? value : null;
}

export function isOnSpecial(product) {
  return Boolean(
    isAvailable(product) &&
      (originalPrice(product) || /special|club price|fresh deals|weekly special/i.test(String(product.promo || "")))
  );
}

export function specialSaving(product) {
  const was = originalPrice(product);
  return was ? was - product.current : 0;
}

export function productVisual(product) {
  if (!product.imageUrl) return product.icon;
  const src = String(product.imageUrl).replaceAll("&", "&amp;").replaceAll('"', "&quot;");
  return `<img src="${src}" alt="" loading="lazy" />`;
}

export function money(value) {
  return nzCurrency.format(value);
}

export function signalKeyFor(product) {
  const availability = availabilityKey(product);
  if (availability !== "inStock") return availability;
  const low = minPrice(product);
  if (low !== null && product.current <= low) return "buyNow";
  if (isNearLow(product)) return "nearLowSignal";
  const mean = average(product);
  if (mean !== null && product.current > mean * 1.08) return "waitSignal";
  return "normalSignal";
}

export function availabilityKey(product) {
  const status = String(product.availabilityStatus || "").toLowerCase();
  if (/out of stock|sold out|unavailable/.test(status)) return "outOfStock";
  if (/low stock|limited availability/.test(status)) return "lowStock";
  if (/in stock|available/.test(status)) return "inStock";
  return product.source === "api" ? "unknownStock" : "inStock";
}

export function isAvailable(product) {
  return ["inStock", "lowStock"].includes(availabilityKey(product));
}
