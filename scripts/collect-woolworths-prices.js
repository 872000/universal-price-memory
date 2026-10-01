#!/usr/bin/env node

const {
  dbPath,
  saveCollectedProduct,
} = require("../lib/db");
const { parseArgs } = require("../lib/cli");
const {
  decodeHtml,
  fetchJson,
  fetchText,
  parseUiVersion,
  productUrl: canonicalProductUrl,
  stockcodeFromInput,
  textFrom,
  woolworthsHeaders,
} = require("../lib/woolworths");

function usage() {
  console.log(`
Usage:
  node scripts/collect-woolworths-prices.js --stockcode 123456
  node scripts/collect-woolworths-prices.js --url "https://www.woolworths.co.nz/..."

Options:
  --stockcode <code>  Woolworths NZ stockcode.
  --url <url>         Full Woolworths NZ product URL.
  --store <id>        Store id label for the snapshot. Defaults to online.
  --region <name>     Optional region label, e.g. Auckland.
  --debug             Print extraction source and write status.
`);
}

function candidateUrls(stockcode) {
  return [
    `https://www.woolworths.co.nz/shop/productdetails?stockcode=${encodeURIComponent(stockcode)}`,
    `https://www.woolworths.co.nz/shop/productdetails/${encodeURIComponent(stockcode)}`,
    `https://www.countdown.co.nz/shop/productdetails?stockcode=${encodeURIComponent(stockcode)}`,
  ];
}

function productUrlFor(stockcode, sourceUrl) {
  if (sourceUrl && /^https?:\/\//i.test(sourceUrl)) return sourceUrl;
  return canonicalProductUrl(stockcode);
}

async function fetchFirstAvailable(urls) {
  const failures = [];
  for (const url of urls) {
    try {
      return await fetchText(url);
    } catch (error) {
      failures.push(`${url}: ${error.message}`);
    }
  }
  throw new Error(`Could not fetch product page.\n${failures.join("\n")}`);
}

function numberFrom(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const match = String(value).replace(",", "").match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

function titleCase(value) {
  return (
    textFrom(value)
      ?.replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
      .replace(/'S\b/g, "'s") || null
  );
}

function categoryName(value) {
  if (!value) return null;
  if (typeof value === "string") return textFrom(value);
  if (typeof value === "object") return textFrom(value.name || value.label || value.title);
  return null;
}

function categoryFromApiProduct(product) {
  return (
    categoryName(product.breadcrumb?.department) ||
    categoryName(product.breadcrumb?.aisle) ||
    categoryName(product.category)
  );
}

function availabilityStatusFrom(value) {
  const status = textFrom(value);
  if (!status) return null;
  const normalized = status.split("/").at(-1).replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  if (/out of stock|sold out|unavailable/.test(normalized)) return "Out of Stock";
  if (/low stock|limited availability/.test(normalized)) return "Low Stock";
  if (/in stock|available/.test(normalized)) return "In Stock";
  return titleCase(normalized);
}

function sizeTokenFromName(value) {
  const name = textFrom(value);
  if (!name) return null;
  return textFrom(name.match(/\b\d+(?:\.\d+)?\s*(?:kg|g|ml|l|pack|pk)\b/i)?.[0]);
}

function metricAmount(value) {
  const match = String(value || "")
    .trim()
    .match(/^(\d+(?:\.\d+)?)\s*(kg|g|ml|l)$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  return {
    dimension: unit === "kg" || unit === "g" ? "mass" : "volume",
    amount: unit === "kg" || unit === "l" ? amount * 1000 : amount,
  };
}

function multipackDisplay(product, packageType, volumeSize) {
  const packCount = Number(packageType?.match(/^(\d+)\s*pack$/i)?.[1]);
  if (!Number.isFinite(packCount) || !volumeSize) return null;

  const volume = metricAmount(volumeSize);
  const cupMeasure = metricAmount(product.size?.cupMeasure);
  const cupPrice = numberFrom(product.size?.cupPrice);
  const currentPrice = numberFrom(product.price?.salePrice ?? product.price?.originalPrice);
  const fallback = `${packageType} · ${volumeSize}`;

  if (!volume || !cupMeasure || volume.dimension !== cupMeasure.dimension || cupPrice === null || currentPrice === null) {
    return fallback;
  }

  const singlePrice = (volume.amount / cupMeasure.amount) * cupPrice;
  const multipackPrice = singlePrice * packCount;
  return Math.abs(multipackPrice - currentPrice) < Math.abs(singlePrice - currentPrice)
    ? `${packCount} x ${volumeSize}`
    : fallback;
}

function sizeFromApiProduct(product) {
  const size = product.size && typeof product.size === "object" ? product.size : {};
  const directSize = typeof product.size === "string" ? textFrom(product.size) : null;
  const packageType = textFrom(size.packageType);
  const volumeSize = textFrom(size.volumeSize);
  const unit = textFrom(product.unit);
  const multipackSize = multipackDisplay(product, packageType, volumeSize);

  return (
    multipackSize ||
    volumeSize ||
    textFrom(product.volumeSize || product.packageSize) ||
    (unit && /^kg$/i.test(unit) ? "per kg" : null) ||
    directSize ||
    (packageType && /\d/.test(packageType) ? packageType : null) ||
    sizeTokenFromName(product.name) ||
    (unit && !/^each$/i.test(unit) ? unit : null) ||
    packageType ||
    (unit && /^each$/i.test(unit) ? "each" : null)
  );
}

function extractJsonLd(html) {
  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  return blocks.flatMap((block, index) => {
    try {
      const parsed = JSON.parse(decodeHtml(block[1]));
      return (Array.isArray(parsed) ? parsed : [parsed]).map((json) => ({
        json,
        source: `script:application/ld+json[${index}]`,
      }));
    } catch {
      return [];
    }
  });
}

function extractNextData(html) {
  const match = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return null;
  try {
    return {
      json: JSON.parse(decodeHtml(match[1])),
      source: "script#__NEXT_DATA__",
    };
  } catch {
    return null;
  }
}

function walk(value, visitor, source, seen = new Set()) {
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, visitor, `${source}[${index}]`, seen));
    return;
  }

  visitor(value, source);
  Object.entries(value).forEach(([key, item]) => walk(item, visitor, `${source}.${key}`, seen));
}

function productFromWoolworthsApi(json, sourceUrl) {
  const stockcode = textFrom(json.sku || json.stockcode || json.stockCode);
  const salePrice = numberFrom(json.price?.salePrice);
  const fallbackPrice = numberFrom(json.price?.originalPrice);
  const currentPrice = salePrice ?? fallbackPrice;
  const originalPrice = json.price?.canShowOriginalPrice ? numberFrom(json.price?.originalPrice) : null;
  const imageUrl =
    textFrom(json.images?.[0]?.big || json.images?.[0]?.small) ||
    textFrom(json.bigImageUrl || json.smallImageUrl);
  const promoText = promoTextFromApiProduct(json);
  const unitPrice = unitPriceFromApiProduct(json);
  const size = sizeFromApiProduct(json);

  return {
    stockcode,
    name: titleCase(json.name),
    brand: titleCase(json.brand),
    category: categoryFromApiProduct(json),
    size,
    imageUrl,
    price: currentPrice,
    originalPrice,
    unitPrice,
    promoText,
    availabilityStatus: availabilityStatusFrom(json.availabilityStatus),
    productUrl: productUrlFor(stockcode, sourceUrl),
    source: "api:/api/v1/products/{stockcode}",
    rawJson: json,
  };
}

function unitPriceFromApiProduct(product) {
  const cupPrice = numberFrom(product.size?.cupPrice);
  const cupMeasure = textFrom(product.size?.cupMeasure);
  if (cupPrice !== null && cupMeasure) return `$${cupPrice.toFixed(2)} / ${cupMeasure}`;
  return textFrom(product.unitPrice || product.cupString || product.pricePerUnit);
}

function promoTextFromApiProduct(product) {
  const tags = product.productTags || [];
  const tagNames = tags
    .map((tag) => {
      if (tag.additionalTag?.name) return tag.additionalTag.name;
      if (tag.multiBuy?.description) return tag.multiBuy.description;
      if (tag.bonusPoints?.description) return tag.bonusPoints.description;
      if (tag.tagType === "IsSpecial") return "Special";
      return null;
    })
    .filter(Boolean);

  if (tagNames.length) return tagNames.join("; ");
  if (product.price?.isClubPrice) return "Club price";
  if (product.price?.isSpecial) return "Special";
  return textFrom(product.promoText || product.promotion || product.offerDescription);
}

function extractProductFromObject(root, sourceRoot) {
  const candidates = [];

  walk(
    root,
    (object, source) => {
      const name = object.name || object.productName || object.displayName || object.description || object.title;
      const stockcode =
        object.stockcode || object.stockCode || object.sku || object.productId || object.productID || object.articleId;
      const offer = Array.isArray(object.offers) ? object.offers[0] : object.offers;
      const objectPrice = typeof object.price === "object" ? object.price?.value || object.price?.amount : object.price;
      const price =
        objectPrice ||
        object.salePrice ||
        object.currentPrice ||
        object.cupPrice ||
        object.listPrice ||
        object.offerPrice ||
        offer?.price ||
        offer?.lowPrice;

      const numericPrice = numberFrom(price);
      if (name && numericPrice !== null) {
        candidates.push({
          stockcode: stockcode ? String(stockcode) : null,
          name: textFrom(name),
          brand: textFrom(object.brand?.name || object.brand || object.vendor || object.supplier),
          category:
            categoryName(object.category) ||
            categoryName(object.department) ||
            categoryName(object.productGroup),
          size: sizeFromApiProduct(object),
          imageUrl: textFrom(Array.isArray(object.image) ? object.image[0] : object.image || object.imageUrl),
          price: numericPrice,
          originalPrice: numberFrom(object.originalPrice || object.wasPrice || offer?.highPrice),
          unitPrice: textFrom(object.unitPrice || object.cupString || object.pricePerUnit),
          promoText: textFrom(object.promoText || object.promotion || object.badge || object.offerDescription),
          availabilityStatus: availabilityStatusFrom(
            object.availabilityStatus || object.availability || offer?.availability
          ),
          source,
          rawJson: object,
        });
      }
    },
    sourceRoot
  );

  return candidates.sort((a, b) => scoreProduct(b) - scoreProduct(a))[0] || null;
}

function scoreProduct(product) {
  let score = 0;
  if (product.stockcode) score += 4;
  if (product.brand) score += 1;
  if (product.imageUrl) score += 1;
  if (product.category) score += 1;
  if (product.unitPrice) score += 1;
  if (product.promoText) score += 1;
  return score;
}

function extractMetaProduct(html) {
  const title =
    html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const image = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1];
  const price =
    html.match(/"price"\s*:\s*"?(\d+(?:\.\d+)?)"?/i)?.[1] ||
    html.match(/"salePrice"\s*:\s*"?(\d+(?:\.\d+)?)"?/i)?.[1] ||
    html.match(/\$\s*(\d+(?:\.\d{2})?)/)?.[1];

  if (!title || price === null) return null;

  return {
    name: textFrom(title.replace(/\s*\|\s*Woolworths.*$/i, "")),
    imageUrl: textFrom(image),
    price: numberFrom(price),
    availabilityStatus: availabilityStatusFrom(
      html.match(/"availabilityStatus"\s*:\s*"([^"]+)"/i)?.[1] ||
        html.match(/"availability"\s*:\s*"([^"]+)"/i)?.[1]
    ),
    source: "meta-tags",
  };
}

function extractProductFromHtml(html) {
  for (const block of extractJsonLd(html)) {
    const product = extractProductFromObject(block.json, block.source);
    if (product) return product;
  }

  const nextData = extractNextData(html);
  if (nextData) {
    const product = extractProductFromObject(nextData.json, nextData.source);
    if (product) return product;
  }

  return extractMetaProduct(html);
}

function validateProduct(product) {
  const missing = [];
  if (!product.stockcode) missing.push("stockcode");
  if (!product.name) missing.push("product name");
  if (
    product.price === null ||
    product.price === undefined ||
    !Number.isFinite(Number(product.price)) ||
    Number(product.price) <= 0
  ) {
    missing.push("current price (> 0)");
  }
  if (!product.productUrl) missing.push("product url");
  return missing;
}

function debugLog(args, message) {
  if (args.debug) console.log(message);
}

async function collectProduct(args) {
  const urls = args.url ? [args.url] : candidateUrls(args.stockcode);
  const page = await fetchFirstAvailable(urls);
  const pageStockcode = args.stockcode || stockcodeFromInput(page.finalUrl) || stockcodeFromInput(args.url);
  const uiVersion = parseUiVersion(page.text);

  debugLog(args, `Debug: page fetched (${page.text.length} bytes)`);
  debugLog(args, `Debug: identified stockcode: ${pageStockcode || "not found"}`);
  debugLog(args, `Debug: ui version: ${uiVersion}`);

  if (pageStockcode) {
    const apiUrl = new URL(`/api/v1/products/${encodeURIComponent(pageStockcode)}`, "https://www.woolworths.co.nz");
    try {
      const api = await fetchJson(apiUrl.href, {
        headers: woolworthsHeaders({ uiVersion, referer: page.finalUrl }),
      });
      const product = productFromWoolworthsApi(api.json, page.finalUrl);
      product.sourceUrl = api.finalUrl;
      return product;
    } catch (error) {
      debugLog(args, `Debug: API extraction failed: ${error.message}`);
    }
  }

  const htmlProduct = extractProductFromHtml(page.text);
  if (htmlProduct) {
    htmlProduct.stockcode ||= pageStockcode;
    htmlProduct.productUrl ||= productUrlFor(htmlProduct.stockcode, page.finalUrl);
  }
  return htmlProduct;
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.help || (!args.stockcode && !args.url)) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  if (args.stockcode && !/^\d+$/.test(args.stockcode)) {
    throw new Error("--stockcode must contain digits only.");
  }

  const extracted = await collectProduct(args);
  if (!extracted) {
    throw new Error(
      "Could not find product data in the Woolworths response. Tried /api/v1/products/{stockcode}, JSON-LD, __NEXT_DATA__, and meta tags."
    );
  }

  const missing = validateProduct(extracted);
  if (missing.length) {
    throw new Error(
      `Refusing to write incomplete product data. Missing: ${missing.join(", ")}. Source: ${extracted.source || "unknown"}`
    );
  }

  debugLog(args, `Debug: product name: ${extracted.name}`);
  debugLog(args, `Debug: current price: ${extracted.price}`);
  debugLog(args, `Debug: availability: ${extracted.availabilityStatus || "unknown"}`);
  debugLog(args, `Debug: raw JSON source: ${extracted.source || "unknown"}`);

  const product = {
    id: `ww-${extracted.stockcode}`,
    stockcode: extracted.stockcode,
    sourceUrl: extracted.productUrl,
    name: extracted.name,
    brand: extracted.brand,
    category: extracted.category,
    size: extracted.size,
    imageUrl: extracted.imageUrl,
  };
  const store = {
    id: args.store || "online",
    name: args.store ? `Woolworths NZ ${args.store}` : "Woolworths NZ Online",
    region: args.region,
  };

  const capturedAt = new Date().toISOString();
  const snapshot = {
    price: extracted.price,
    originalPrice: extracted.originalPrice,
    unitPrice: extracted.unitPrice,
    promoText: extracted.promoText,
    availabilityStatus: extracted.availabilityStatus,
    rawJson: JSON.stringify({
      source: extracted.source,
      sourceUrl: extracted.sourceUrl,
      productUrl: extracted.productUrl,
      product: extracted.rawJson,
    }),
    capturedAt,
  };
  const { productId, storeId } = saveCollectedProduct({ product, store, snapshot });

  debugLog(args, "Debug: database write: success");

  const result = {
    database: dbPath,
    wroteToDatabase: true,
    source: extracted.source,
    productId,
    stockcode: extracted.stockcode,
    name: extracted.name,
    brand: extracted.brand,
    price: extracted.price,
    originalPrice: extracted.originalPrice,
    unitPrice: extracted.unitPrice,
    promoText: extracted.promoText,
    availabilityStatus: extracted.availabilityStatus,
    imageUrl: extracted.imageUrl,
    productUrl: extracted.productUrl,
    storeId,
    capturedAt,
  };

  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  availabilityStatusFrom,
  extractProductFromHtml,
  main,
  numberFrom,
  productFromWoolworthsApi,
  sizeFromApiProduct,
  validateProduct,
};
