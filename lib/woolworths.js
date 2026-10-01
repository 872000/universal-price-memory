const DEFAULT_UI_VERSION = "7.75.24";
const DEFAULT_TIMEOUT_MS = 20_000;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

function decodeHtml(value) {
  return String(value || "")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .trim();
}

function textFrom(value) {
  if (value === null || value === undefined) return null;
  const text = decodeHtml(String(value)).replace(/\s+/g, " ").trim();
  return text || null;
}

function parseUiVersion(html) {
  return (
    html.match(/uiVersion:\s*['"]([^'"]+)['"]/i)?.[1] ||
    html.match(/"uiVersion"\s*:\s*"([^"]+)"/i)?.[1] ||
    DEFAULT_UI_VERSION
  );
}

function stockcodeFromInput(value) {
  const input = String(value || "").trim();
  if (/^\d+$/.test(input)) return input;

  try {
    const url = new URL(input);
    const stockcode =
      url.searchParams.get("stockcode") ||
      url.searchParams.get("Stockcode") ||
      url.pathname.match(/productdetails\/(\d+)/)?.[1] ||
      url.pathname.match(/\/(\d{4,})(?:\/)?$/)?.[1];
    return /^\d+$/.test(stockcode || "") ? stockcode : null;
  } catch {
    return null;
  }
}

function productUrl(stockcode, name) {
  const url = new URL("https://www.woolworths.co.nz/shop/productdetails");
  url.searchParams.set("stockcode", stockcode);
  if (name) url.searchParams.set("name", name);
  return url.href;
}

function woolworthsHeaders({ uiVersion = DEFAULT_UI_VERSION, referer } = {}) {
  return {
    accept: "application/json, text/plain, */*",
    "accept-language": "en-NZ,en;q=0.9",
    "cache-control": "no-cache",
    "content-type": "application/json",
    expires: "Sat, 01 Jan 2000 00:00:00 GMT",
    pragma: "no-cache",
    referer: referer || "https://www.woolworths.co.nz/",
    "user-agent": USER_AGENT,
    "x-requested-with": "OnlineShopping.WebApp",
    "x-ui-ver": uiVersion,
  };
}

async function fetchText(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let response;
  try {
    response = await fetch(url, {
      headers: {
        accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        "accept-language": "en-NZ,en;q=0.9",
        "user-agent": USER_AGENT,
        ...options.headers,
      },
      redirect: "follow",
      signal: options.signal || AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs}ms: ${url}`);
    }
    throw new Error(`Request failed for ${url}: ${error.message}`);
  }

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}: ${text.slice(0, 200)}`);
  }

  return {
    finalUrl: response.url,
    contentType: response.headers.get("content-type") || "",
    text,
  };
}

async function fetchJson(url, options = {}) {
  const { finalUrl, contentType, text } = await fetchText(url, options);
  try {
    return {
      finalUrl,
      contentType,
      json: JSON.parse(text),
      rawText: text,
    };
  } catch {
    throw new Error(`Expected JSON from ${url}, got ${contentType || "unknown content type"}.`);
  }
}

module.exports = {
  DEFAULT_UI_VERSION,
  decodeHtml,
  fetchJson,
  fetchText,
  parseUiVersion,
  productUrl,
  stockcodeFromInput,
  textFrom,
  woolworthsHeaders,
};
