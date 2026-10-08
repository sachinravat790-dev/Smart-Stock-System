import assert from "node:assert/strict";
import test from "node:test";
import {
  centsToAmount,
  isUuid,
  priceToCents,
  validateSale,
} from "../src/sales-validation.js";

const productId = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

test("sale validation accepts one or more unique positive integer quantities", () => {
  assert.deepEqual(validateSale({
    payment_method: "UPI",
    items: [{ product_id: productId, quantity: "2" }],
  }), {
    valid: true,
    sale: { payment_method: "UPI", items: [{ product_id: productId, quantity: 2 }] },
  });
});

test("sale validation rejects missing, empty, oversized, and malformed carts", () => {
  for (const value of [
    null,
    {},
    { payment_method: "CASH", items: [] },
    { payment_method: "CASH", items: "not-an-array" },
    { payment_method: "CASH", items: Array.from({ length: 101 }, () => ({ product_id: productId, quantity: 1 })) },
  ]) {
    assert.equal(validateSale(value).valid, false);
  }
});

test("sale validation accepts only supported payment methods", () => {
  for (const payment_method of ["CASH", "UPI", "CARD"]) {
    assert.equal(validateSale({
      payment_method,
      items: [{ product_id: productId, quantity: 1 }],
    }).valid, true);
  }
  for (const payment_method of [undefined, "cash", "WIRE", 1]) {
    assert.equal(validateSale({
      payment_method,
      items: [{ product_id: productId, quantity: 1 }],
    }).valid, false);
  }
});

test("sale validation rejects malformed IDs, duplicate products, and invalid quantities", () => {
  for (const product_id of ["not-a-uuid", null]) {
    assert.equal(validateSale({
      payment_method: "CASH",
      items: [{ product_id, quantity: 1 }],
    }).valid, false);
  }
  assert.equal(validateSale({
    payment_method: "CASH",
    items: [
      { product_id: productId, quantity: 1 },
      { product_id: productId, quantity: 2 },
    ],
  }).valid, false);

  for (const quantity of [0, -1, 1.5, "1.2", "text", "", 2147483648]) {
    assert.equal(validateSale({
      payment_method: "CASH",
      items: [{ product_id: productId, quantity }],
    }).valid, false);
  }
});

test("sale prices and totals use exact integer cents", () => {
  assert.equal(priceToCents("10"), 1000n);
  assert.equal(priceToCents("10.05"), 1005n);
  assert.equal(centsToAmount(1005n * 3n), "30.15");
  assert.equal(priceToCents("10.999"), null);
  assert.equal(priceToCents("-1.00"), null);
});

test("sale UUID validation accepts UUIDs and rejects malformed IDs", () => {
  assert.equal(isUuid(productId), true);
  assert.equal(isUuid("not-a-uuid"), false);
});
