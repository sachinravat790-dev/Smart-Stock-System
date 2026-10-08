import assert from "node:assert/strict";
import test, { after } from "node:test";
import { databasePool } from "../src/database.js";
import {
  expiryStatusFilters,
  productStatusColumns,
} from "../src/product-status.js";

after(async () => {
  await databasePool.end();
});

test("database expiry status and day calculations use dynamic CURRENT_DATE boundaries", async () => {
  const result = await databasePool.query(
    `WITH offsets(day_offset) AS (
       VALUES (-1), (0), (1), (7), (8), (30), (31), (NULL::integer)
     ),
     fixtures AS (
       SELECT day_offset,
              CASE
                WHEN day_offset IS NULL THEN NULL
                ELSE CURRENT_DATE + day_offset
              END::date AS expiry_date,
              1::integer AS current_stock,
              1::integer AS minimum_stock
       FROM offsets
     )
     SELECT day_offset, expiry_status, days_to_expiry
     FROM fixtures AS product
     CROSS JOIN LATERAL (SELECT ${productStatusColumns("product")}) AS status
     ORDER BY day_offset NULLS LAST`,
  );
  assert.deepEqual(result.rows, [
    { day_offset: -1, expiry_status: "EXPIRED", days_to_expiry: -1 },
    { day_offset: 0, expiry_status: "EXPIRED", days_to_expiry: 0 },
    { day_offset: 1, expiry_status: "EXPIRING_SOON_7_DAYS", days_to_expiry: 1 },
    { day_offset: 7, expiry_status: "EXPIRING_SOON_7_DAYS", days_to_expiry: 7 },
    { day_offset: 8, expiry_status: "EXPIRING_30_DAYS", days_to_expiry: 8 },
    { day_offset: 30, expiry_status: "EXPIRING_30_DAYS", days_to_expiry: 30 },
    { day_offset: 31, expiry_status: "SAFE", days_to_expiry: 31 },
    { day_offset: null, expiry_status: "NO_EXPIRY_DATE", days_to_expiry: null },
  ]);
});

test("database stock statuses preserve Phase 2 thresholds including minimum stock zero", async () => {
  const result = await databasePool.query(
    `WITH fixtures(current_stock, minimum_stock, expiry_date) AS (
       VALUES
         (0, 0, NULL::date),
         (4, 5, NULL::date),
         (5, 5, NULL::date),
         (6, 5, NULL::date),
         (1, 0, NULL::date)
     )
     SELECT current_stock, minimum_stock, stock_status
     FROM fixtures AS product
     CROSS JOIN LATERAL (SELECT ${productStatusColumns("product")}) AS status
     ORDER BY current_stock, minimum_stock`,
  );
  assert.deepEqual(
    result.rows.map(({ current_stock, minimum_stock, stock_status }) => ({
      current_stock,
      minimum_stock,
      stock_status,
    })),
    [
      { current_stock: 0, minimum_stock: 0, stock_status: "Out of Stock" },
      { current_stock: 1, minimum_stock: 0, stock_status: "In Stock" },
      { current_stock: 4, minimum_stock: 5, stock_status: "Low Stock" },
      { current_stock: 5, minimum_stock: 5, stock_status: "Low Stock" },
      { current_stock: 6, minimum_stock: 5, stock_status: "In Stock" },
    ],
  );
});

test("expiry filter predicates divide the dynamic date ranges without overlap", async () => {
  const filterChecks = [
    ["expired", [-1, 0]],
    ["expiring-7-days", [1, 7]],
    ["expiring-30-days", [8, 30]],
    ["safe", [31]],
    ["no-expiry-date", [null]],
  ];
  for (const [filterName, expectedOffsets] of filterChecks) {
    const result = await databasePool.query(
      `WITH offsets(day_offset) AS (
         VALUES (-1), (0), (1), (7), (8), (30), (31), (NULL::integer)
       ),
       fixtures AS (
         SELECT day_offset,
                CASE
                  WHEN day_offset IS NULL THEN NULL
                  ELSE CURRENT_DATE + day_offset
                END::date AS expiry_date
         FROM offsets
       )
       SELECT day_offset
       FROM fixtures AS product
       WHERE ${expiryStatusFilters[filterName]("product")}
       ORDER BY day_offset NULLS LAST`,
    );
    assert.deepEqual(
      result.rows.map((row) => row.day_offset),
      expectedOffsets,
      `${filterName} should match its exact boundary`,
    );
  }
});
