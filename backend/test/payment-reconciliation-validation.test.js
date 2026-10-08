import assert from "node:assert/strict";
import test from "node:test";
import {
  centsToMoney,
  parseMoneyToCents,
  paymentMethods,
  paymentStatus,
  validateHistoryFilters,
  validatePeriod,
  validateReconciliation,
  validateSummaryFilters,
} from "../src/payment-reconciliation-validation.js";

const validPayload = {
  period_start: "2026-10-07",
  period_end: "2026-10-07",
  actual_amounts: { CASH: "100.10", UPI: "25.00", CARD: "0" },
};

test("Phase 5 payment methods remain the supported reconciliation methods", () => {
  assert.deepEqual(paymentMethods, ["CASH", "UPI", "CARD"]);
});

test("money parsing and formatting use exact integer cents", () => {
  assert.equal(parseMoneyToCents("100.10"), 10010n);
  assert.equal(parseMoneyToCents("0.01"), 1n);
  assert.equal(parseMoneyToCents(1.25), 125n);
  assert.equal(centsToMoney(10010n), "100.10");
  assert.equal(centsToMoney(-5n), "-0.05");
  for (const value of [null, undefined, "", " ", "-1", "1.001", "1e2", -1.25, "100000000000000000000"]) {
    assert.equal(parseMoneyToCents(value), null);
  }
});

test("payment status follows the direction of the exact difference", () => {
  assert.equal(paymentStatus(0n), "PAYMENT_MATCHED");
  assert.equal(paymentStatus(-1n), "SHORT_COLLECTION");
  assert.equal(paymentStatus(1n), "EXCESS_COLLECTION");
});

test("reconciliation validates a date range and all three actual amounts", () => {
  assert.deepEqual(validateReconciliation(validPayload), {
    valid: true,
    reconciliation: {
      period_start: "2026-10-07",
      period_end: "2026-10-07",
      actual_amounts: { CASH: "100.10", UPI: "25.00", CARD: "0.00" },
      reason: null,
      notes: null,
    },
  });
});

test("null, missing, negative, malformed, and unsafe actual amounts are rejected", () => {
  for (const actualAmount of [null, undefined, "", -1, "-1.00", "1.001", "NaN"]) {
    const payload = structuredClone(validPayload);
    payload.actual_amounts.CASH = actualAmount;
    assert.equal(validateReconciliation(payload).valid, false);
  }
  assert.equal(validateReconciliation({
    ...validPayload,
    actual_amounts: { ...validPayload.actual_amounts, WIRE: "10.00" },
  }).valid, false);
  for (const method of paymentMethods) {
    const payload = structuredClone(validPayload);
    delete payload.actual_amounts[method];
    assert.equal(validateReconciliation(payload).valid, false);
  }
});

test("date ranges reject malformed and reversed dates", () => {
  for (const value of [
    { period_start: "2026-02-30", period_end: "2026-03-01" },
    { period_start: "2026-10-08", period_end: "2026-10-07" },
    { period_start: null, period_end: "2026-10-07" },
  ]) {
    assert.equal(validatePeriod(value).valid, false);
  }
  assert.equal(validateReconciliation({
    ...validPayload,
    period_end: "2026-10-06",
  }).valid, false);
});

test("summary and history filters validate method, status, user, and period", () => {
  assert.equal(validateSummaryFilters({
    dateFrom: "2026-10-01",
    dateTo: "2026-10-07",
    paymentMethod: "UPI",
  }).valid, true);
  assert.equal(validateSummaryFilters({
    dateFrom: "2026-10-01",
    dateTo: "2026-10-07",
    staffId: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
  }).valid, true);
  assert.equal(validateHistoryFilters({
    dateFrom: "2026-10-01",
    dateTo: "2026-10-07",
    paymentMethod: "CARD",
    status: "SHORT_COLLECTION",
    reconciledBy: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
  }).valid, true);
  for (const query of [
    { dateFrom: "2026-10-07" },
    { dateFrom: "2026-10-08", dateTo: "2026-10-07" },
    { paymentMethod: "WIRE" },
    { status: "THEFT" },
    { reconciledBy: "bad-id" },
  ]) {
    assert.equal(validateHistoryFilters(query).valid, false);
  }
  assert.equal(validateSummaryFilters({
    dateFrom: "2026-10-01",
    dateTo: "2026-10-07",
    paymentMethod: "WIRE",
  }).valid, false);
});

test("reason and notes are bounded and reject control characters", () => {
  assert.equal(validateReconciliation({
    ...validPayload,
    reason: "Counted by owner",
    notes: "Verified against cash drawer",
  }).valid, true);
  assert.equal(validateReconciliation({
    ...validPayload,
    reason: "x".repeat(201),
  }).valid, false);
  assert.equal(validateReconciliation({
    ...validPayload,
    notes: "invalid\u0000note",
  }).valid, false);
});
