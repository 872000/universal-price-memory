#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { numberOption, parseArgs, readListFile } = require("../lib/cli");
const { all, quote } = require("../lib/db");
const { stockcodeFromInput } = require("../lib/woolworths");

function usage() {
  console.log(`
Usage:
  node scripts/collect-batch.js --file data/watch-products.txt

Input file:
  One product per line. Lines can be Woolworths NZ product URLs or raw stockcodes.
  Blank lines and lines starting with # are ignored.

Options:
  --file <path>       Required input file.
  --store <id>        Optional store id passed to each collection.
  --region <name>     Optional region passed to each collection.
  --debug             Print each collector command's full output.
  --delay <ms>        Delay between products. Defaults to 1200.
  --weekly            Skip products that already have a snapshot this local calendar week.
`);
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function stockcodeFromItem(item) {
  return stockcodeFromInput(item);
}

function uniqueItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = stockcodeFromItem(item) || item;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function startOfCurrentWeek() {
  const start = new Date();
  const daysSinceMonday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - daysSinceMonday);
  start.setHours(0, 0, 0, 0);
  return start.toISOString();
}

function dueWeeklyItems(items, storeId) {
  const weekStart = startOfCurrentWeek();
  const collectedIds = new Set(
    all(`
      select distinct product_id as productId
      from price_snapshots
      where store_id = ${quote(storeId)}
        and datetime(captured_at) >= datetime(${quote(weekStart)})
    `).map((row) => row.productId)
  );
  const due = items.filter((item) => {
    const stockcode = stockcodeFromItem(item);
    return !stockcode || !collectedIds.has(`ww-${stockcode}`);
  });

  return {
    due,
    skipped: items.length - due.length,
    weekStart,
  };
}

function itemArgs(item, args) {
  const result = [];
  if (/^https?:\/\//i.test(item)) {
    result.push("--url", item);
  } else {
    result.push("--stockcode", item);
  }

  if (args.store) result.push("--store", args.store);
  if (args.region) result.push("--region", args.region);
  if (args.debug) result.push("--debug");
  return result;
}

function main() {
  const args = parseArgs(process.argv, { delay: 1200 });
  if (args.help || !args.file) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  const filePath = path.resolve(args.file);
  const rawItems = readListFile(filePath);
  const sourceItems = uniqueItems(rawItems);
  const delay = numberOption(args.delay, { name: "delay", defaultValue: 1200, min: 0 });

  if (!sourceItems.length) {
    console.error(`No products found in ${filePath}`);
    process.exit(1);
  }

  const weekly = args.weekly ? dueWeeklyItems(sourceItems, args.store || "online") : null;
  const items = weekly?.due || sourceItems;

  const summary = {
    file: filePath,
    sourceTotal: rawItems.length,
    uniqueTotal: sourceItems.length,
    duplicatesIgnored: rawItems.length - sourceItems.length,
    total: items.length,
    skippedThisWeek: weekly?.skipped || 0,
    weekStart: weekly?.weekStart || null,
    succeeded: 0,
    failed: 0,
    failures: [],
  };

  if (!items.length) {
    console.log("All products already have a snapshot for this week.");
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log(
    `Collecting ${items.length} product(s) from ${filePath}` +
      (weekly ? ` (${weekly.skipped} already collected this week)` : "")
  );

  items.forEach((item, index) => {
    const collectorArgs = ["scripts/collect-woolworths-prices.js", ...itemArgs(item, args)];
    console.log(`\n[${index + 1}/${items.length}] ${item}`);

    const result = spawnSync(process.execPath, collectorArgs, {
      cwd: path.resolve(__dirname, ".."),
      encoding: "utf8",
    });

    if (args.debug || result.status !== 0) {
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
    }

    if (result.status === 0) {
      summary.succeeded += 1;
      if (!args.debug) {
        const parsed = parseCollectorOutput(result.stdout);
        console.log(parsed ? `Saved ${parsed.stockcode} - ${parsed.name} @ ${parsed.price}` : "Saved");
      }
    } else {
      summary.failed += 1;
      summary.failures.push({
        item,
        error: result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`,
      });
      console.log("Failed");
    }

    if (index < items.length - 1 && delay > 0) sleep(delay);
  });

  console.log("\nBatch summary:");
  console.log(JSON.stringify(summary, null, 2));
  if (summary.failed) process.exit(1);
}

function parseCollectorOutput(output) {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(output.slice(start, end + 1));
  } catch {
    return null;
  }
}

if (require.main === module) main();

module.exports = {
  dueWeeklyItems,
  parseCollectorOutput,
  startOfCurrentWeek,
  uniqueItems,
};
