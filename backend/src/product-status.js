export const expiryStatusFilters = Object.freeze({
  expired: (product) => `${column(product, "expiry_date")} <= CURRENT_DATE`,
  "expiring-7-days": (product) =>
    `${column(product, "expiry_date")} > CURRENT_DATE AND ${column(product, "expiry_date")} <= CURRENT_DATE + 7`,
  "expiring-30-days": (product) =>
    `${column(product, "expiry_date")} > CURRENT_DATE + 7 AND ${column(product, "expiry_date")} <= CURRENT_DATE + 30`,
  safe: (product) => `${column(product, "expiry_date")} > CURRENT_DATE + 30`,
  "no-expiry-date": (product) => `${column(product, "expiry_date")} IS NULL`,
});

export function productStatusColumns(product = "product") {
  return `CASE
    WHEN ${column(product, "current_stock")} = 0 THEN 'Out of Stock'
    WHEN ${column(product, "current_stock")} <= ${column(product, "minimum_stock")} THEN 'Low Stock'
    ELSE 'In Stock'
  END AS stock_status,
  CASE
    WHEN ${column(product, "expiry_date")} IS NULL THEN 'NO_EXPIRY_DATE'
    WHEN ${column(product, "expiry_date")} <= CURRENT_DATE THEN 'EXPIRED'
    WHEN ${column(product, "expiry_date")} <= CURRENT_DATE + 7 THEN 'EXPIRING_SOON_7_DAYS'
    WHEN ${column(product, "expiry_date")} <= CURRENT_DATE + 30 THEN 'EXPIRING_30_DAYS'
    ELSE 'SAFE'
  END AS expiry_status,
  (${column(product, "expiry_date")} - CURRENT_DATE)::integer AS days_to_expiry`;
}

function column(product, name) {
  return product ? `${product}.${name}` : name;
}
