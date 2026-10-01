const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "price tracker test-"));
process.env.PRICE_TRACKER_DB = path.join(tempDir, "test.sqlite");

const { all, getProductHistory, saveCollectedProduct } = require("../lib/db");

test.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

test("saveCollectedProduct atomically writes all three tables", () => {
  const ids = saveCollectedProduct({
    product: { id: "ww-123", stockcode: "123", name: "Test Milk", category: "Fridge & Deli" },
    store: { id: "online", name: "Woolworths NZ Online" },
    snapshot: {
      price: 4.5,
      originalPrice: 5,
      availabilityStatus: "Low Stock",
      capturedAt: "2026-07-20T00:00:00.000Z",
    },
  });

  assert.deepEqual(ids, { productId: "ww-123", storeId: "online" });
  assert.equal(all("select count(*) count from products")[0].count, 1);
  assert.equal(all("select count(*) count from stores")[0].count, 1);
  assert.equal(all("select count(*) count from price_snapshots")[0].count, 1);
  assert.equal(getProductHistory("123").snapshots[0].price, 4.5);
  assert.equal(getProductHistory("123").snapshots[0].availabilityStatus, "Low Stock");
});

test("failed collection rolls back store and product writes", () => {
  assert.throws(() =>
    saveCollectedProduct({
      product: { id: "ww-bad", stockcode: "999" },
      store: { id: "rollback-store", name: "Should Roll Back" },
      snapshot: { price: 1, capturedAt: "2026-07-20T00:00:00.000Z" },
    })
  );

  assert.equal(all("select count(*) count from stores where id = 'rollback-store'")[0].count, 0);
  assert.equal(all("select count(*) count from products where id = 'ww-bad'")[0].count, 0);
});
