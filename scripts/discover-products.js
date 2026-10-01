#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { numberOption, parseArgs, readListFile } = require("../lib/cli");
const {
  fetchJson,
  fetchText,
  parseUiVersion,
  productUrl,
  stockcodeFromInput,
  textFrom,
  woolworthsHeaders,
} = require("../lib/woolworths");

const DEFAULT_OUTPUT = "data/watch-products.txt";
const DEFAULT_LIMIT = 20;

function usage() {
  console.log(`
Usage:
  node scripts/discover-products.js --keyword "toilet paper"
  node scripts/discover-products.js --file data/search-keywords.txt

Options:
  --keyword <term>    Search term to discover Woolworths NZ products.
  --file <path>       File with one search term per line.
  --limit <number>    Products requested per search page. Defaults to 20.
  --pages <number>    Max pages requested per keyword. Defaults to 1.
  --delay <ms>        Delay between search requests. Defaults to 700.
  --output <path>     Product watch list to append to. Defaults to data/watch-products.txt.
  --summary-only      Print counts and a small sample instead of every added product.
  --debug             Print search URL and source details.
`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function uniqueKeywords(args) {
  const keywords = [];
  if (args.keyword) keywords.push(args.keyword);
  if (args.file) keywords.push(...readListFile(path.resolve(args.file)));
  return [...new Set(keywords.map((keyword) => keyword.trim()).filter(Boolean))];
}

function stockcodeFromLine(value) {
  const line = value.trim();
  if (!line || line.startsWith("#")) return null;
  return stockcodeFromInput(line);
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

function productUrlForItem(product) {
  const stockcode = textFrom(product.sku || product.stockcode || product.stockCode);
  const slug = textFrom(product.slug) || slugify(product.name);
  return productUrl(stockcode, slug);
}

function normaliseSearchItem(item) {
  const stockcode = textFrom(item.sku || item.stockcode || item.stockCode);
  const name = textFrom(item.name || item.displayName || item.title);
  if (!stockcode || !name) return null;

  return {
    stockcode,
    name,
    brand: textFrom(item.brand),
    price: item.price?.salePrice ?? item.price?.originalPrice ?? null,
    url: productUrlForItem(item),
  };
}

function existingStockcodes(outputPath) {
  if (!fs.existsSync(outputPath)) return new Set();
  const lines = fs.readFileSync(outputPath, "utf8").split(/\r?\n/);
  return new Set(lines.map(stockcodeFromLine).filter(Boolean));
}

function ensureWatchFile(outputPath) {
  if (fs.existsSync(outputPath)) return;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(
    outputPath,
    "# One Woolworths NZ product URL or stockcode per line.\n# Blank lines and comments are ignored.\n\n",
    "utf8"
  );
}

async function discoverKeyword(keyword, options) {
  const products = new Map();
  const pageFailures = [];
  let totalItems = null;

  for (let page = 1; page <= options.pages; page += 1) {
    const searchUrl = new URL("https://www.woolworths.co.nz/api/v1/products");
    searchUrl.searchParams.set("search", keyword);
    searchUrl.searchParams.set("target", "Search");
    searchUrl.searchParams.set("page", String(page));
    searchUrl.searchParams.set("size", String(options.limit));
    searchUrl.searchParams.set("sort", "Relevance");

    if (options.debug) console.log(`Debug: search URL: ${searchUrl.href}`);

    let response;
    try {
      response = await fetchJson(searchUrl.href, {
        headers: woolworthsHeaders({
          uiVersion: options.uiVersion,
          referer: `https://www.woolworths.co.nz/shop/searchproducts?search=${encodeURIComponent(keyword)}`,
        }),
      });
    } catch (error) {
      if (page === 1) throw error;
      pageFailures.push({ page, error: error.message });
      break;
    }

    const items = response.json?.products?.items;
    totalItems = Number(response.json?.products?.totalItems ?? totalItems);
    if (options.debug) {
      console.log(
        `Debug: page ${page}/${options.pages}, items: ${Array.isArray(items) ? items.length : "invalid"}, total: ${totalItems}`
      );
    }
    if (!Array.isArray(items)) {
      const error = `Unexpected search response shape for "${keyword}" page ${page}. Source: ${response.finalUrl}`;
      if (page === 1) throw new Error(error);
      pageFailures.push({ page, error });
      break;
    }

    items
      .filter((item) => item?.type === "Product" || item?.sku || item?.stockcode || item?.stockCode)
      .map(normaliseSearchItem)
      .filter(Boolean)
      .forEach((product) => products.set(product.stockcode, product));

    if (!items.length || items.length < options.limit || (Number.isFinite(totalItems) && page * options.limit >= totalItems)) {
      break;
    }
    if (page < options.pages && options.delay > 0) await sleep(options.delay);
  }

  return { products: [...products.values()], pageFailures, totalItems };
}

async function main() {
  const args = parseArgs(process.argv, { limit: DEFAULT_LIMIT, output: DEFAULT_OUTPUT });
  const keywords = uniqueKeywords(args);

  if (args.help || !keywords.length) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  const limit = numberOption(args.limit, { name: "limit", defaultValue: DEFAULT_LIMIT, min: 1, integer: true });
  const pages = numberOption(args.pages, { name: "pages", defaultValue: 1, min: 1, integer: true });
  const delay = numberOption(args.delay, { name: "delay", defaultValue: 700, min: 0 });
  const outputPath = path.resolve(args.output || DEFAULT_OUTPUT);
  ensureWatchFile(outputPath);

  const home = await fetchText("https://www.woolworths.co.nz/");
  const uiVersion = parseUiVersion(home.text);
  const seen = existingStockcodes(outputPath);
  const addedLines = [];
  const summary = {
    output: outputPath,
    uiVersion,
    limit,
    pages,
    delay,
    keywords,
    found: 0,
    added: 0,
    skippedExisting: 0,
    addedProducts: [],
    failedKeywords: [],
  };

  if (args.debug) {
    console.log(`Debug: homepage fetched (${home.text.length} bytes)`);
    console.log(`Debug: ui version: ${uiVersion}`);
  }

  for (const [index, keyword] of keywords.entries()) {
    let discovered = [];
    try {
      const result = await discoverKeyword(keyword, { limit, pages, delay, uiVersion, debug: args.debug });
      discovered = result.products;
      result.pageFailures.forEach((failure) => {
        summary.failedKeywords.push({ keyword, ...failure });
        console.error(`Discovery stopped for "${keyword}" at page ${failure.page}: ${failure.error}`);
      });
    } catch (error) {
      summary.failedKeywords.push({ keyword, error: error.message });
      console.error(`Discovery failed for "${keyword}": ${error.message}`);
    }
    summary.found += discovered.length;

    for (const product of discovered) {
      if (seen.has(product.stockcode)) {
        summary.skippedExisting += 1;
        continue;
      }
      seen.add(product.stockcode);
      addedLines.push(product.url);
      summary.added += 1;
      summary.addedProducts.push(product);
    }

    if (index < keywords.length - 1 && delay > 0) await sleep(delay);
  }

  if (summary.found === 0 && summary.failedKeywords.length) {
    throw new Error("All keyword searches failed; the watch list was not changed.");
  }

  if (addedLines.length) {
    const current = fs.readFileSync(outputPath, "utf8");
    const prefix = current.endsWith("\n") ? "" : "\n";
    fs.appendFileSync(outputPath, `${prefix}${addedLines.join("\n")}\n`, "utf8");
  }

  if (args["summary-only"]) {
    const { addedProducts, ...compactSummary } = summary;
    compactSummary.addedProductsSample = addedProducts.slice(0, 10);
    console.log(JSON.stringify(compactSummary, null, 2));
  } else {
    console.log(JSON.stringify(summary, null, 2));
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  main,
  normaliseSearchItem,
  slugify,
};
