#!/usr/bin/env node

const { dbPath, ensureDatabase } = require("../lib/db");

ensureDatabase();
console.log(`SQLite database ready: ${dbPath}`);
