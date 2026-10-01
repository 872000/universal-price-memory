import { fetchProducts, hydrateProductHistory } from "./api.mjs?v=6";
import { categoryLabels, dates, mockProducts, promoLabels, translations } from "./catalog-data.mjs?v=6";
import {
  availabilityKey,
  average,
  createMockProducts,
  discountRatio,
  isAvailable,
  isNearLow,
  isOnSpecial,
  minPrice,
  money,
  originalPrice,
  previousPrice,
  productVisual,
  signalKeyFor,
  specialSaving,
} from "./product-model.mjs?v=6";
import { renderPriceChart } from "./price-chart.mjs?v=6";
import { matchesProductSearch } from "./search.mjs?v=6";

let products = createMockProducts(mockProducts, dates);

const requestedLanguage = new URLSearchParams(window.location.search).get("lang");
const initialLanguage = ["zh", "en"].includes(requestedLanguage)
  ? requestedLanguage
  : localStorage.getItem("woolworths-nz-language") || "zh";

const state = {
  selectedId: products[0].id,
  detailOpen: false,
  aiOpen: false,
  query: "",
  category: "all",
  sort: "deal",
  dealsOnly: false,
  inStockOnly: true,
  specialCategory: "all",
  language: initialLanguage,
  watch: JSON.parse(localStorage.getItem("woolworths-nz-watch") || "{}"),
};

const productList = document.querySelector("#productList");
const specialList = document.querySelector("#specialList");
const specialCategoryTabs = document.querySelector("#specialCategoryTabs");
const specialsCount = document.querySelector("#specialsCount");
const searchInput = document.querySelector("#searchInput");
const categorySelect = document.querySelector("#categorySelect");
const dealsOnlyInput = document.querySelector("#dealsOnlyInput");
const inStockOnlyInput = document.querySelector("#inStockOnlyInput");
const selectedBrand = document.querySelector("#selectedBrand");
const selectedName = document.querySelector("#selectedName");
const selectedMeta = document.querySelector("#selectedMeta");
const heroImage = document.querySelector("#heroImage");
const currentPrice = document.querySelector("#currentPrice");
const lowestPrice = document.querySelector("#lowestPrice");
const averagePrice = document.querySelector("#averagePrice");
const buySignal = document.querySelector("#buySignal");
const priceChart = document.querySelector("#priceChart");
const targetPriceInput = document.querySelector("#targetPriceInput");
const historicalLowInput = document.querySelector("#historicalLowInput");
const watchForm = document.querySelector("#watchForm");
const watchStatus = document.querySelector("#watchStatus");
const watchList = document.querySelector("#watchList");
const watchCount = document.querySelector("#watchCount");
const aiSummary = document.querySelector("#aiSummary");
const aiOverlay = document.querySelector("#aiOverlay");
const openAiButton = document.querySelector("#openAiButton");
const closeAiButton = document.querySelector("#closeAiButton");
const plannerList = document.querySelector("#plannerList");
const plannerTotal = document.querySelector("#plannerTotal");
const seedWatchButton = document.querySelector("#seedWatchButton");
const exportButton = document.querySelector("#exportButton");
const installButton = document.querySelector("#installButton");
const settingsButton = document.querySelector("#settingsButton");
const settingsOverlay = document.querySelector("#settingsOverlay");
const closeSettingsButton = document.querySelector("#closeSettingsButton");
const languageToggle = document.querySelector(".language-toggle");
const dataSourceLabel = document.querySelector("#dataSourceLabel");
const detailPanel = document.querySelector("#detailPanel");
const detailBackdrop = document.querySelector("#detailBackdrop");
const closeDetailButton = document.querySelector("#closeDetailButton");
let deferredInstallPrompt = null;

function t(key, ...params) {
  const value = translations[state.language]?.[key] ?? translations.zh[key] ?? key;
  return typeof value === "function" ? value(...params) : value;
}

function localizedLabel(map, value) {
  return map[value]?.[state.language] || value || "";
}

function displayCategory(category) {
  return localizedLabel(categoryLabels, category);
}

function displayPromo(promo) {
  return localizedLabel(promoLabels, promo);
}

function applyTranslations() {
  document.documentElement.lang = state.language === "zh" ? "zh-CN" : "en-NZ";
  document.title = `Woolworths NZ ${t("appTitle")}`;
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-attr]").forEach((element) => {
    element.dataset.i18nAttr.split(";").forEach((pair) => {
      const [attribute, key] = pair.split(":");
      if (attribute && key) element.setAttribute(attribute, t(key));
    });
  });
  searchInput.placeholder = t("searchPlaceholder");
  settingsButton.setAttribute("aria-label", t("settings"));
  settingsButton.title = t("settings");
  exportButton.setAttribute("aria-label", t("exportWatchlist"));
  exportButton.title = t("exportWatchlist");
  installButton.setAttribute("aria-label", t("installApp"));
  installButton.title = t("installApp");
  closeSettingsButton.setAttribute("aria-label", t("close"));
  closeSettingsButton.title = t("close");
  closeDetailButton.setAttribute("aria-label", t("close"));
  closeDetailButton.title = t("close");
  closeAiButton.setAttribute("aria-label", t("close"));
  closeAiButton.title = t("close");
  openAiButton.setAttribute("aria-label", t("openAiJudgement"));
  openAiButton.title = t("openAiJudgement");
  languageToggle.setAttribute("aria-label", t("language"));
  specialCategoryTabs.setAttribute("aria-label", t("specialCategoryLabel"));
  languageToggle.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("active", button.dataset.lang === state.language);
  });
  if (dataSourceLabel) {
    const isCollected = products.some((product) => product.source === "api");
    dataSourceLabel.textContent = isCollected ? t("collectedDataSource") : t("demoDataSource");
  }
}

function selectedProduct() {
  return products.find((product) => product.id === state.selectedId) || products[0];
}

function saveWatch() {
  localStorage.setItem("woolworths-nz-watch", JSON.stringify(state.watch));
}

function initCategories() {
  categorySelect.innerHTML = `<option value="all">${t("allCategories")}</option>`;
  const categories = [...new Set(products.map((product) => product.category))].sort();
  categorySelect.insertAdjacentHTML(
    "beforeend",
    categories.map((category) => `<option value="${category}">${displayCategory(category)}</option>`).join("")
  );
  categorySelect.value = state.category;
}

function filteredProducts() {
  return products
    .filter((product) => {
      const matchesQuery = matchesProductSearch(product, state.query);
      const matchesCategory = state.category === "all" || product.category === state.category;
      const matchesDeal = !state.dealsOnly || isNearLow(product);
      const matchesStock = !state.inStockOnly || isAvailable(product);
      return matchesQuery && matchesCategory && matchesDeal && matchesStock;
    })
    .sort((a, b) => {
      if (isAvailable(a) !== isAvailable(b)) return isAvailable(a) ? -1 : 1;
      if (state.sort === "name") return a.name.localeCompare(b.name);
      if (state.sort === "drop") return previousPrice(b) - b.current - (previousPrice(a) - a.current);
      return discountRatio(b) - discountRatio(a);
    });
}

function renderMetrics() {
  document.querySelector("#trackedCount").textContent = products.length;
  document.querySelector("#dealCount").textContent = products.filter(isNearLow).length;
  document.querySelector("#pointsCount").textContent = products.filter((product) => product.points > 0).length;
}

function renderSpecials() {
  const specials = products
    .filter(isOnSpecial)
    .sort((a, b) => {
      const aWas = originalPrice(a) || a.current;
      const bWas = originalPrice(b) || b.current;
      return specialSaving(b) / bWas - specialSaving(a) / aWas;
    });
  const categories = [...new Set(specials.map((product) => product.category))].sort((a, b) =>
    displayCategory(a).localeCompare(displayCategory(b), state.language === "zh" ? "zh-CN" : "en-NZ")
  );

  if (state.specialCategory !== "all" && !categories.includes(state.specialCategory)) {
    state.specialCategory = "all";
  }

  const tabs = ["all", ...categories];
  specialCategoryTabs.innerHTML = tabs
    .map((category) => {
      const active = category === state.specialCategory;
      const label = category === "all" ? t("allSpecials") : displayCategory(category);
      return `<button type="button" role="tab" aria-selected="${active}" class="${active ? "active" : ""}" data-special-category="${category}">${label}</button>`;
    })
    .join("");

  const visible = specials.filter(
    (product) => state.specialCategory === "all" || product.category === state.specialCategory
  );
  specialsCount.textContent = t("specialProductsCount", visible.length);

  if (!visible.length) {
    specialList.innerHTML = `<div class="empty-state compact">${t("noSpecials")}</div>`;
    return;
  }

  specialList.innerHTML = visible
    .slice(0, 12)
    .map((product) => {
      const was = originalPrice(product);
      const saving = specialSaving(product);
      return `
        <button class="special-card" type="button" data-id="${product.id}">
          <span class="product-thumb" style="background:${product.color}">${productVisual(product)}</span>
          <span class="special-copy">
            <span class="special-name">${product.name}</span>
            <span class="special-category">${displayCategory(product.category)}</span>
            <span class="special-prices">
              <strong>${money(product.current)}</strong>
              ${was ? `<s>${money(was)}</s>` : ""}
            </span>
            <span class="special-saving">${saving > 0 ? t("saveAmount", money(saving)) : displayPromo(product.promo)}</span>
          </span>
        </button>
      `;
    })
    .join("");
}

function renderProductList() {
  const rows = filteredProducts();
  if (!rows.length) {
    productList.innerHTML = `<div class="empty-state">${t("noMatches")}</div>`;
    return;
  }

  productList.innerHTML = rows
    .map((product) => {
      const drop = previousPrice(product) - product.current;
      const lowBadge = isNearLow(product) ? `<span class="badge hot">${t("lowBadge")}</span>` : "";
      const pointsBadge = product.points ? `<span class="badge points">${product.points} pts</span>` : "";
      const stockKey = availabilityKey(product);
      const stockBadge = stockKey === "inStock" ? "" : `<span class="badge stock ${stockKey}">${t(stockKey)}</span>`;
      return `
        <button class="product-card ${stockKey === "outOfStock" ? "out-of-stock" : ""} ${product.id === state.selectedId ? "active" : ""}" type="button" data-id="${product.id}">
          <span class="product-thumb" style="background:${product.color}">${productVisual(product)}</span>
          <span class="product-copy">
            <span class="product-title">${product.name}</span>
            <span class="product-subtitle">${product.brand} · ${product.size}</span>
            <span class="tag-row">${stockBadge}${lowBadge}${pointsBadge}<span class="badge">${displayPromo(product.promo)}</span></span>
          </span>
          <span class="product-price">
            <strong>${money(product.current)}</strong>
            <small>${drop > 0 ? t("dropAmount", money(drop)) : t("stablePrice")}</small>
          </span>
        </button>
      `;
    })
    .join("");
}

function renderChart(product) {
  renderPriceChart(priceChart, product, dates, money);
}

function signalFor(product) {
  return t(signalKeyFor(product));
}

function renderDetail() {
  const product = selectedProduct();
  if (!product) return;
  const watch = state.watch[product.id];

  detailPanel.hidden = !state.detailOpen;
  detailBackdrop.hidden = !state.detailOpen;
  if (!state.detailOpen) return;

  selectedBrand.textContent = product.brand;
  selectedName.textContent = product.name;
  selectedMeta.textContent = `${displayCategory(product.category)} · ${product.size} · ${displayPromo(product.promo)} · ${t(availabilityKey(product))}`;
  heroImage.innerHTML = productVisual(product);
  heroImage.style.background = product.imageUrl ? "#ffffff" : product.color;
  currentPrice.textContent = money(product.current);
  lowestPrice.textContent = minPrice(product) === null ? t("noInStockHistory") : money(minPrice(product));
  averagePrice.textContent = average(product) === null ? t("noInStockHistory") : money(average(product));
  buySignal.textContent = signalFor(product);
  targetPriceInput.value = watch?.targetPrice ?? (minPrice(product) ?? product.current).toFixed(2);
  historicalLowInput.checked = Boolean(watch?.historicalLow);
  watchStatus.textContent = watch ? t("watched") : t("unwatched");
  renderChart(product);
  renderPlanner();
  loadHistoryForProduct(product);
}

function renderAiSummary(product) {
  const diffFromAverage = (average(product) ?? product.current) - product.current;
  const target = state.watch[product.id]?.targetPrice;
  const unavailable = !isAvailable(product);
  const watchLine = unavailable
    ? t("unavailableHint")
    : target
      ? product.current <= target
        ? t("targetReached", money(target))
        : t("targetDistance", money(target), money(product.current - target))
      : t("noTarget");
  const toneClass = unavailable || signalKeyFor(product) === "waitSignal" ? "stop" : isNearLow(product) ? "" : "warn";
  aiSummary.innerHTML = `
    <div class="insight ${toneClass}">
      <strong>${signalFor(product)}</strong>
      <small>${unavailable ? t("unavailableHint") : diffFromAverage >= 0 ? t("belowAverage", money(Math.abs(diffFromAverage))) : t("aboveAverage", money(Math.abs(diffFromAverage)))}</small>
    </div>
    <div class="insight">
      <strong>${product.points ? t("pointsPromo", product.points) : t("noPoints")}</strong>
      <small>${product.points ? t("pointsHint") : t("noPointsHint")}</small>
    </div>
    <div class="insight warn">
      <strong>${t("watchlist")}</strong>
      <small>${watchLine}</small>
    </div>
  `;
}

function renderPlanner() {
  const candidates = products
    .filter((product) => isAvailable(product) && (product.points > 0 || isNearLow(product)))
    .sort((a, b) => b.points / b.current + discountRatio(b) - (a.points / a.current + discountRatio(a)))
    .slice(0, 4);
  const total = candidates.reduce((sum, product) => sum + product.current, 0);
  plannerTotal.textContent = money(total);
  plannerList.innerHTML = candidates
    .map(
      (product) => `
        <div class="planner-item">
          <span>
            <strong>${product.name}</strong>
            <small>${product.points ? `${product.points} pts` : t("lowRestock")} · ${signalFor(product)}</small>
          </span>
          <strong>${money(product.current)}</strong>
        </div>
      `
    )
    .join("");
}

function renderWatchList() {
  const entries = Object.values(state.watch);
  watchCount.textContent = entries.length;
  if (!entries.length) {
    watchList.innerHTML = `<div class="empty-state">${t("emptyWatch")}</div>`;
    return;
  }

  watchList.innerHTML = entries
    .map((entry) => {
      const product = products.find((item) => item.id === entry.productId);
      if (!product) return "";
      const reached = isAvailable(product) && product.current <= Number(entry.targetPrice);
      const status = isAvailable(product) ? (reached ? t("triggered") : t("waiting")) : t(availabilityKey(product));
      return `
        <div class="watch-item">
          <strong>${product.name}</strong>
          <small>${money(product.current)} · ${t("watchTarget", money(Number(entry.targetPrice)))} · ${status}</small>
        </div>
      `;
    })
    .join("");
}

function render() {
  applyTranslations();
  initCategories();
  renderMetrics();
  renderSpecials();
  renderProductList();
  renderDetail();
  renderWatchList();
  if (state.aiOpen) renderAiSummary(selectedProduct());
}

async function loadProductsFromApi() {
  try {
    const collectedProducts = await fetchProducts();
    if (!collectedProducts.length) return;

    products = collectedProducts;
    state.selectedId = products[0].id;
    initCategories();
    render();
  } catch {
    // Static file mode or server not running: keep mock data as fallback.
  }
}

async function loadHistoryForProduct(product) {
  const updated = await hydrateProductHistory(product);
  if (updated && state.selectedId === product.id) render();
}

function openProductDetail(productId) {
  state.selectedId = productId;
  state.detailOpen = true;
  render();
}

function openAi() {
  const product = selectedProduct();
  if (!product) return;
  state.aiOpen = true;
  renderAiSummary(product);
  aiOverlay.hidden = false;
  openAiButton.setAttribute("aria-expanded", "true");
  closeAiButton.focus();
}

function closeAi(restoreFocus = true) {
  state.aiOpen = false;
  aiOverlay.hidden = true;
  openAiButton.setAttribute("aria-expanded", "false");
  if (restoreFocus && state.detailOpen) openAiButton.focus();
}

productList.addEventListener("click", (event) => {
  const card = event.target.closest("[data-id]");
  if (!card) return;
  openProductDetail(card.dataset.id);
});

specialList.addEventListener("click", (event) => {
  const card = event.target.closest("[data-id]");
  if (!card) return;
  openProductDetail(card.dataset.id);
});

specialCategoryTabs.addEventListener("click", (event) => {
  const tab = event.target.closest("[data-special-category]");
  if (!tab) return;
  state.specialCategory = tab.dataset.specialCategory;
  renderSpecials();
});

function closeDetail() {
  closeAi(false);
  state.detailOpen = false;
  render();
}

closeDetailButton.addEventListener("click", closeDetail);
detailBackdrop.addEventListener("click", closeDetail);
openAiButton.addEventListener("click", openAi);
closeAiButton.addEventListener("click", closeAi);
aiOverlay.addEventListener("click", (event) => {
  if (event.target === aiOverlay) closeAi();
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (state.aiOpen) {
    closeAi();
  } else if (state.detailOpen) {
    closeDetail();
  }
});

searchInput.addEventListener("input", (event) => {
  state.query = event.target.value;
  renderProductList();
});

categorySelect.addEventListener("change", (event) => {
  state.category = event.target.value;
  renderProductList();
});

dealsOnlyInput.addEventListener("change", (event) => {
  state.dealsOnly = event.target.checked;
  renderProductList();
});

inStockOnlyInput.addEventListener("change", (event) => {
  state.inStockOnly = event.target.checked;
  renderProductList();
});

document.querySelector(".segmented").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-sort]");
  if (!button) return;
  state.sort = button.dataset.sort;
  document.querySelectorAll(".segmented button").forEach((item) => item.classList.toggle("active", item === button));
  renderProductList();
});

watchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const product = selectedProduct();
  state.watch[product.id] = {
    productId: product.id,
    targetPrice: Number(targetPriceInput.value || minPrice(product) || product.current).toFixed(2),
    historicalLow: historicalLowInput.checked,
    createdAt: new Date().toISOString(),
  };
  saveWatch();
  render();
});

seedWatchButton.addEventListener("click", () => {
  products.filter(isNearLow).forEach((product) => {
    state.watch[product.id] = {
      productId: product.id,
      targetPrice: minPrice(product).toFixed(2),
      historicalLow: true,
      createdAt: new Date().toISOString(),
    };
  });
  saveWatch();
  render();
});

settingsButton.addEventListener("click", () => {
  settingsOverlay.hidden = false;
});

closeSettingsButton.addEventListener("click", () => {
  settingsOverlay.hidden = true;
});

settingsOverlay.addEventListener("click", (event) => {
  if (event.target === settingsOverlay) settingsOverlay.hidden = true;
});

languageToggle.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-lang]");
  if (!button) return;
  state.language = button.dataset.lang;
  localStorage.setItem("woolworths-nz-language", state.language);
  render();
});

exportButton.addEventListener("click", () => {
  const payload = JSON.stringify(Object.values(state.watch), null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "woolworths-nz-watchlist.json";
  link.click();
  URL.revokeObjectURL(url);
});

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  installButton.hidden = false;
});

installButton.addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  installButton.hidden = true;
  deferredInstallPrompt = null;
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  installButton.hidden = true;
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // The app still works normally when service workers are unavailable.
    });
  });
}

render();
loadProductsFromApi();
