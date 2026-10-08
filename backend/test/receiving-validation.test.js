import assert from "node:assert/strict";
import test from "node:test";
import {
  validateBarcode,
  validateNewProductReceiving,
  validateReceiving,
} from "../src/receiving-validation.js";

test("barcode is required, trimmed, and bounded", () => {
  assert.deepEqual(validateBarcode("  000123  "), { valid: true, barcode: "000123" });
  assert.equal(validateBarcode("").valid, false);
  assert.equal(validateBarcode("x".repeat(129)).valid, false);
  assert.equal(validateBarcode("12\u0000").valid, false);
});

test("receiving quantity must be a positive whole number", () => {
  const base = { barcode: "A-1", quantity: 2, purchase_price: 1.2 };
  assert.equal(validateReceiving(base).valid, true);
  for (const quantity of [0, -1, 1.5, "letters", ""]) {
    assert.equal(validateReceiving({ ...base, quantity }).valid, false);
  }
});

test("purchase price and supplier are validated without affecting historical values", () => {
  const base = { barcode: "A-1", quantity: "1", purchase_price: "2.10" };
  const valid = validateReceiving({ ...base, supplier: "  Store supplier  " });
  assert.equal(valid.valid, true);
  assert.equal(valid.receiving.purchase_price, "2.10");
  assert.equal(valid.receiving.supplier, "Store supplier");
  assert.equal(validateReceiving({ ...base, purchase_price: -1 }).valid, false);
  assert.equal(validateReceiving({ ...base, supplier: "x".repeat(161) }).valid, false);
});

test("new product receipt requires product name, category, and brand", () => {
  const base = {
    barcode: "NEW-1",
    quantity: 25,
    purchase_price: 1.25,
    product_name: "Rice",
    category: "Grocery",
    brand: "Local",
    selling_price: 2,
    minimum_stock: 3,
  };
  const valid = validateNewProductReceiving(base);
  assert.equal(valid.valid, true);
  assert.equal(valid.product.current_stock, 25);
  assert.equal(validateNewProductReceiving({ ...base, brand: "" }).valid, false);
});
