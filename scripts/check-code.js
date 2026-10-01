#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const ignoredDirectories = new Set([".git", "node_modules"]);

function javascriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (ignoredDirectories.has(entry.name)) return [];
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return javascriptFiles(fullPath);
    return entry.isFile() && /\.(?:js|mjs)$/.test(entry.name) ? [fullPath] : [];
  });
}

const files = javascriptFiles(rootDir);
const failures = [];

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    failures.push({ file: path.relative(rootDir, file), error: result.stderr.trim() || result.stdout.trim() });
  }
}

if (failures.length) {
  failures.forEach(({ file, error }) => console.error(`${file}:\n${error}`));
  process.exit(1);
}

console.log(`Syntax check passed for ${files.length} JavaScript files.`);
