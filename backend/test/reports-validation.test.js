import test from "node:test";
import assert from "node:assert/strict";
import { validateReportsQuery } from "../src/reports-validation.js";

test("reports accept a valid date range and default top sellers to five", () => {
  assert.deepEqual(
    validateReportsQuery({ dateFrom: "2026-10-01", dateTo: "2026-10-08" }),
    {
      valid: true,
      filters: { dateFrom: "2026-10-01", dateTo: "2026-10-08", top: 5 },
    },
  );
});

test("reports accept only Top 5 or Top 10", () => {
  assert.equal(
    validateReportsQuery({
      dateFrom: "2026-10-01",
      dateTo: "2026-10-08",
      top: "10",
    }).filters.top,
    10,
  );
  assert.equal(
    validateReportsQuery({
      dateFrom: "2026-10-01",
      dateTo: "2026-10-08",
      top: "7",
    }).valid,
    false,
  );
});

test("reports reject malformed and reversed date ranges", () => {
  for (const query of [
    { dateFrom: "2026-02-30", dateTo: "2026-03-01" },
    { dateFrom: "2026-10-09", dateTo: "2026-10-08" },
    { dateFrom: "2026-10-08" },
  ]) {
    assert.equal(validateReportsQuery(query).valid, false);
  }
});
