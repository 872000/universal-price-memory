#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const flags = new Set(process.argv.slice(2));

function runStage(label, args) {
  console.log(`\n=== ${label} ===`);
  const result = spawnSync(process.execPath, args, {
    cwd: rootDir,
    stdio: "inherit",
  });
  return result.status ?? 1;
}

const commonDebug = flags.has("--debug") ? ["--debug"] : [];
let discoverStatus = 0;

if (!flags.has("--skip-discovery")) {
  discoverStatus = runStage("Discover current products", [
    "scripts/discover-products.js",
    "--file",
    "data/search-keywords-weekly.txt",
    "--limit",
    "15",
    "--delay",
    "700",
    "--summary-only",
    ...commonDebug,
  ]);
}

const collectArgs = [
  "scripts/collect-batch.js",
  "--file",
  "data/watch-products.txt",
  "--delay",
  "1200",
  ...commonDebug,
];

if (!flags.has("--force")) collectArgs.push("--weekly");
const collectStatus = runStage("Collect weekly price snapshots", collectArgs);

if (discoverStatus !== 0) console.error("Product discovery failed; existing watch-list products were still collected.");
if (discoverStatus !== 0 || collectStatus !== 0) process.exit(1);
