import { apiProductToView } from "./product-model.mjs?v=6";

export async function fetchProducts() {
  const response = await fetch("/api/products", { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  return (payload.products || []).map(apiProductToView);
}

export async function hydrateProductHistory(product) {
  if (product.source !== "api" || product.historyLoaded || product.historyLoading) return false;
  product.historyLoading = true;

  try {
    const response = await fetch(`/api/products/${encodeURIComponent(product.id)}/history`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const snapshots = payload.snapshots || [];
    if (snapshots.length) {
      product.history = snapshots.map((snapshot) => Number(snapshot.price)).filter(Number.isFinite);
      product.historyDates = snapshots.map((snapshot) => String(snapshot.capturedAt).slice(0, 10));
      product.historyAvailability = snapshots.map((snapshot) => snapshot.availabilityStatus || null);
      const latest = snapshots.at(-1);
      product.current = product.history.at(-1) || product.current;
      product.promo = latest?.promoText || product.promo;
      product.availabilityStatus = latest?.availabilityStatus || product.availabilityStatus;
      product.size = payload.product.size || product.size;
      product.brand = payload.product.brand || product.brand;
      product.category = payload.product.category || product.category;
    }
    product.historyLoaded = true;
    return true;
  } catch {
    product.historyLoaded = true;
    return false;
  } finally {
    product.historyLoading = false;
  }
}
