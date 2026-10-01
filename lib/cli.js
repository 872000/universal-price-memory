const fs = require("node:fs");

function parseArgs(argv, defaults = {}) {
  const args = { ...defaults };
  for (let index = 2; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith("--")) continue;

    const key = current.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

function numberOption(value, { name, defaultValue, min = -Infinity, integer = false }) {
  const resolved = value === undefined || value === null || value === "" ? defaultValue : Number(value);
  if (!Number.isFinite(resolved) || resolved < min || (integer && !Number.isInteger(resolved))) {
    const type = integer ? "integer" : "number";
    throw new Error(`--${name} must be a ${type} greater than or equal to ${min}.`);
  }
  return resolved;
}

function readListFile(filePath) {
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

module.exports = {
  numberOption,
  parseArgs,
  readListFile,
};
