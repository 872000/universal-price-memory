#!/usr/bin/env node

const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { ensureDatabase, getProductHistory, listProducts } = require("./lib/db");

const rootDir = __dirname;
const port = Number(process.env.PORT || 5173);
const publicFiles = new Set(["index.html", "styles.css", "sw.js", "manifest.webmanifest"]);
const publicFrontendFiles = new Set([
  "frontend/api.mjs",
  "frontend/app.mjs",
  "frontend/catalog-data.mjs",
  "frontend/price-chart.mjs",
  "frontend/product-model.mjs",
  "frontend/search.mjs",
]);

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".svg", "image/svg+xml"],
]);

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function resolveStaticPath(pathname) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const relativePath = decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
  const isPublicFile =
    publicFiles.has(relativePath) ||
    publicFrontendFiles.has(relativePath) ||
    /^icons\/[a-zA-Z0-9._-]+$/.test(relativePath);
  if (!isPublicFile) return null;

  const filePath = path.resolve(rootDir, relativePath);
  const relativeToRoot = path.relative(rootDir, filePath);
  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) return null;
  return filePath;
}

function serveStatic(request, response, pathname) {
  const filePath = resolveStaticPath(pathname);
  if (!filePath) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "content-type": mimeTypes.get(path.extname(filePath)) || "application/octet-stream",
      "cache-control": path.basename(filePath) === "sw.js" ? "no-cache" : "public, max-age=0, must-revalidate",
    });
    response.end(data);
  });
}

function handleApi(request, response, pathname) {
  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Method not allowed" });
    return true;
  }

  if (pathname === "/api/products") {
    sendJson(response, 200, { products: listProducts() });
    return true;
  }

  const historyMatch = pathname.match(/^\/api\/products\/([^/]+)\/history$/);
  if (historyMatch) {
    const productId = decodeURIComponent(historyMatch[1]);
    const history = getProductHistory(productId);
    if (!history) {
      sendJson(response, 404, { error: "Product not found" });
      return true;
    }
    sendJson(response, 200, history);
    return true;
  }

  return false;
}

function createServer() {
  ensureDatabase();
  return http.createServer((request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

    try {
      if (url.pathname.startsWith("/api/") && handleApi(request, response, url.pathname)) {
        return;
      }

      serveStatic(request, response, url.pathname);
    } catch (error) {
      sendJson(response, 500, { error: error.message });
    }
  });
}

function startServer() {
  const server = createServer();
  server.listen(port, "0.0.0.0", () => {
    console.log(`Woolworths NZ price tracker running at http://127.0.0.1:${port}`);
    const lanAddresses = Object.values(os.networkInterfaces())
      .flat()
      .filter((address) => address?.family === "IPv4" && !address.internal)
      .map((address) => `http://${address.address}:${port}`);
    if (lanAddresses.length) console.log(`Open on a phone using the same Wi-Fi: ${lanAddresses.join(" or ")}`);
  });
  return server;
}

if (require.main === module) startServer();

module.exports = {
  createServer,
  resolveStaticPath,
  startServer,
};
