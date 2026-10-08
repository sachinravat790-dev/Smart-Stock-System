import assert from "node:assert/strict";
import test from "node:test";
import { validateActivityFilters } from "../src/staff-activities.js";

const userId = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

test("activity filters accept paginated user/action/product/date/reference filters", () => {
  const result = validateActivityFilters({
    userId,
    actionType: "SALE",
    productSearch: "Coffee 250g",
    dateFrom: "2026-10-01",
    dateTo: "2026-10-07",
    referenceType: "SALE",
    referenceId: "sale-reference",
    page: "2",
    limit: "25",
  });
  assert.equal(result.valid, true);
  assert.equal(result.filters.page, 2);
  assert.equal(result.filters.limit, 25);
});

test("activity filters reject arbitrary actions, malformed IDs, dates, references, and pagination", () => {
  for (const query of [
    { userId: "not-a-uuid" },
    { actionType: "DELETE_ALL" },
    { dateFrom: "2026-02-30" },
    { dateFrom: "2026-10-08", dateTo: "2026-10-07" },
    { referenceType: "SALE" },
    { referenceId: "reference" },
    { page: "0" },
    { page: "not-a-number" },
    { limit: "1000" },
    { productSearch: "x".repeat(161) },
  ]) {
    assert.equal(validateActivityFilters(query).valid, false);
  }
});

test("activity summary filters do not require history pagination parameters", () => {
  const result = validateActivityFilters({
    dateFrom: "2026-10-01",
    dateTo: "2026-10-07",
  }, { pagination: false });
  assert.equal(result.valid, true);
  assert.equal("page" in result.filters, false);
});
