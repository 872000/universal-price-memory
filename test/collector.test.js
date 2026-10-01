const test = require("node:test");
const assert = require("node:assert/strict");

const {
  availabilityStatusFrom,
  extractProductFromHtml,
  productFromWoolworthsApi,
  sizeFromApiProduct,
  validateProduct,
} = require("../scripts/collect-woolworths-prices");

test("API extraction keeps Woolworths fields and object categories", () => {
  const product = productFromWoolworthsApi(
    {
      sku: "808766",
      name: "cotton softs toilet paper 12pk",
      brand: "kellogg's",
      breadcrumb: { department: { name: "Household" } },
      price: { salePrice: 10, originalPrice: 14, canShowOriginalPrice: true, isSpecial: true },
      size: { cupPrice: 0.42, cupMeasure: "100 sheets", volumeSize: "12pack" },
      images: [{ big: "https://example.test/product.jpg" }],
    },
    "https://www.woolworths.co.nz/shop/productdetails?stockcode=808766"
  );

  assert.equal(product.stockcode, "808766");
  assert.equal(product.name, "Cotton Softs Toilet Paper 12pk");
  assert.equal(product.brand, "Kellogg's");
  assert.equal(product.category, "Household");
  assert.equal(product.size, "12pack");
  assert.equal(product.price, 10);
  assert.equal(product.originalPrice, 14);
  assert.equal(product.unitPrice, "$0.42 / 100 sheets");
  assert.equal(product.promoText, "Special");
  assert.equal(product.availabilityStatus, null);
  assert.equal(validateProduct(product).length, 0);
});

test("size extraction prefers package volume and has useful fallbacks", () => {
  assert.equal(
    sizeFromApiProduct({ name: "anchor milk standard blue", unit: "Each", size: { volumeSize: "2L" } }),
    "2L"
  );
  assert.equal(sizeFromApiProduct({ name: "toilet paper 12pk 3 ply", unit: "Each", size: {} }), "12pk");
  assert.equal(sizeFromApiProduct({ name: "bananas loose", unit: "Kg", size: { packageType: "loose" } }), "per kg");
  assert.equal(
    sizeFromApiProduct({ name: "mandarins loose", unit: "Kg", size: { packageType: "min order 200g" } }),
    "per kg"
  );
  assert.equal(
    sizeFromApiProduct({
      name: "yoghurt",
      unit: "Each",
      price: { salePrice: 15.5 },
      size: { packageType: "10 pack", volumeSize: "70g", cupPrice: 2.21, cupMeasure: "100g" },
    }),
    "10 x 70g"
  );
  assert.equal(
    sizeFromApiProduct({
      name: "corn snacks",
      unit: "Each",
      price: { salePrice: 7.95 },
      size: { packageType: "20 pack", volumeSize: "360g", cupPrice: 2.21, cupMeasure: "100g" },
    }),
    "20 pack · 360g"
  );
});

test("JSON-LD fallback does not stringify category objects", () => {
  const html = `
    <script type="application/ld+json">
      {
        "@type": "Product",
        "sku": "123456",
        "name": "Test Pasta",
        "category": { "name": "Pantry" },
        "image": "https://example.test/pasta.jpg",
        "offers": { "price": "3.49", "highPrice": "4.99" }
      }
    </script>
  `;
  const product = extractProductFromHtml(html);

  assert.equal(product.stockcode, "123456");
  assert.equal(product.category, "Pantry");
  assert.equal(product.price, 3.49);
  assert.equal(product.originalPrice, 4.99);
});

test("validation blocks incomplete collected records", () => {
  assert.deepEqual(validateProduct({ name: "No price" }), ["stockcode", "current price (> 0)", "product url"]);
  assert.deepEqual(
    validateProduct({ stockcode: "780294", name: "Unavailable product", price: 0, productUrl: "https://example.test" }),
    ["current price (> 0)"]
  );
});

test("availability statuses are normalised across API and JSON-LD formats", () => {
  assert.equal(availabilityStatusFrom("In Stock"), "In Stock");
  assert.equal(availabilityStatusFrom("https://schema.org/OutOfStock"), "Out of Stock");
  assert.equal(availabilityStatusFrom("LimitedAvailability"), "Low Stock");
});
