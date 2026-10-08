import assert from "node:assert/strict";
import test from "node:test";
import {
  auditReasons,
  calculateAudit,
  validateAudit,
  validateAuditFilters,
} from "../src/stock-audit-validation.js";

const productId = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

test("audit difference and status are derived from expected and physical stock", () => {
  assert.deepEqual(calculateAudit(50, 50), { difference: 0, status: "MATCHED" });
  assert.deepEqual(calculateAudit(50, 47), { difference: -3, status: "UNACCOUNTED_STOCK" });
  assert.deepEqual(calculateAudit(50, 53), { difference: 3, status: "OVERAGE" });
});

test("audit validation accepts a physical count and normalizes optional fields", () => {
  assert.deepEqual(validateAudit({
    product_id: productId,
    physical_stock: "0",
    reason: "COUNTING_ERROR",
    notes: " Counted after closing ",
    expected_stock: 500,
    difference: 500,
    status: "OVERAGE",
  }), {
    valid: true,
    audit: {
      product_id: productId,
      physical_stock: 0,
      reason: "COUNTING_ERROR",
      notes: "Counted after closing",
    },
  });
});

test("audit validation rejects invalid product IDs and non-integer physical counts", () => {
  for (const product_id of ["invalid", null]) {
    assert.equal(validateAudit({ product_id, physical_stock: 1 }).valid, false);
  }
  for (const physical_stock of [-1, 2.5, "abc", "", null, 2147483648]) {
    assert.equal(
      validateAudit({ product_id: productId, physical_stock }).valid,
      false,
    );
  }
  assert.equal(validateAudit({ product_id: productId, physical_stock: 0 }).valid, true);
});

test("audit validation enforces the supported neutral reasons and note length", () => {
  for (const reason of auditReasons) {
    assert.equal(validateAudit({ product_id: productId, physical_stock: 0, reason }).valid, true);
  }
  for (const reason of ["THEFT", "UNKNOWN", 1]) {
    assert.equal(validateAudit({ product_id: productId, physical_stock: 0, reason }).valid, false);
  }
  assert.equal(
    validateAudit({ product_id: productId, physical_stock: 0, notes: "x".repeat(1001) }).valid,
    false,
  );
});

test("audit filters validate status, reason, user, search, and date ranges", () => {
  assert.equal(validateAuditFilters({
    search: "Tea",
    status: "UNACCOUNTED_STOCK",
    reason: "DAMAGE",
    auditedBy: productId,
    dateFrom: "2026-10-01",
    dateTo: "2026-10-07",
  }).valid, true);
  for (const query of [
    { status: "THEFT" },
    { reason: "THEFT" },
    { auditedBy: "not-a-uuid" },
    { dateFrom: "2026-02-30" },
    { dateFrom: "2026-10-08", dateTo: "2026-10-07" },
    { search: "x".repeat(161) },
  ]) {
    assert.equal(validateAuditFilters(query).valid, false);
  }
});
