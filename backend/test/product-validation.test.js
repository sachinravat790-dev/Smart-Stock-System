import assert from "node:assert/strict";
import test from "node:test";
import {
  isValidDate,
  stockStatus,
  validateProduct,
} from "../src/product-validation.js";

const validProduct = {
  product_name: "Tea",
  barcode: "0123456789012",
  category: "Grocery",
  brand: "Local",
  purchase_price: 2.15,
  selling_price: 3.5,
  current_stock: 4,
  minimum_stock: 3,
  expiry_date: "2027-06-30",
  product_image: "https://example.test/product.png",
};

test("product validation accepts a valid product and trims text fields", () => {
  const result = validateProduct({ ...validProduct, product_name: " Tea " });
  assert.equal(result.valid, true);
  assert.equal(result.product.product_name, "Tea");
  assert.equal(result.product.purchase_price, "2.15");
});

test("expiry date and product image are optional", () => {
  const result = validateProduct({ product_name: "Staples" });
  assert.equal(result.valid, true);
  assert.equal(result.product.expiry_date, null);
  assert.equal(result.product.product_image, null);
});

test("product name is required", () => {
  assert.equal(validateProduct({ ...validProduct, product_name: "  " }).valid, false);
});

test("negative prices and stock values are rejected", () => {
  for (const change of [
    { purchase_price: -0.01 },
    { selling_price: -0.01 },
    { current_stock: -1 },
    { minimum_stock: -1 },
  ]) {
    assert.equal(validateProduct({ ...validProduct, ...change }).valid, false);
  }
});

test("barcode is stored as safe bounded text", () => {
  assert.equal(validateProduct({ ...validProduct, barcode: "  0007 " }).product.barcode, "0007");
  assert.equal(validateProduct({ ...validProduct, barcode: `a\u0000b` }).valid, false);
  assert.equal(validateProduct({ ...validProduct, barcode: "x".repeat(129) }).valid, false);
});

test("invalid calendar expiry dates and unsafe image URLs are rejected", () => {
  assert.equal(isValidDate("2027-02-29"), false);
  assert.equal(isValidDate("2028-02-29"), true);
  assert.equal(validateProduct({ ...validProduct, expiry_date: "2027-02-29" }).valid, false);
  assert.equal(validateProduct({ ...validProduct, product_image: "javascript:alert(1)" }).valid, false);
});

test("stock status follows the requested thresholds", () => {
  assert.equal(stockStatus(6, 5), "In Stock");
  assert.equal(stockStatus(5, 5), "Low Stock");
  assert.equal(stockStatus(1, 5), "Low Stock");
  assert.equal(stockStatus(0, 5), "Out of Stock");
});
