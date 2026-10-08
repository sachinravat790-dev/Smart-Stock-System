import { isValidDate } from "./product-validation.js";
import { isUuid } from "./sales-validation.js";

export const auditReasons = Object.freeze([
  "UNRECORDED_SALE",
  "DAMAGE",
  "RETURN",
  "COUNTING_ERROR",
  "MISSING_STOCK",
  "OTHER",
]);

const auditStatuses = new Set(["MATCHED", "UNACCOUNTED_STOCK", "OVERAGE"]);

export function validateAudit(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return invalid("Audit details are required.");
  }
  if (!isUuid(value.product_id)) {
    return invalid("A valid product ID is required.");
  }

  const physicalStock = parsePhysicalStock(value.physical_stock);
  if (physicalStock === null) {
    return invalid("Physical stock must be a non-negative whole number.");
  }

  const reason = value.reason === undefined || value.reason === null || value.reason === ""
    ? null
    : value.reason;
  if (reason !== null && !auditReasons.includes(reason)) {
    return invalid("Select a valid audit reason.");
  }

  const notes = value.notes === undefined || value.notes === null || value.notes === ""
    ? null
    : value.notes;
  if (
    notes !== null &&
    (typeof notes !== "string" ||
      notes.trim().length > 1000 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(notes))
  ) {
    return invalid("Audit notes must be at most 1000 characters and contain no control characters.");
  }

  return {
    valid: true,
    audit: {
      product_id: value.product_id,
      physical_stock: physicalStock,
      reason,
      notes: notes?.trim() || null,
    },
  };
}

export function calculateAudit(expectedStock, physicalStock) {
  const difference = physicalStock - expectedStock;
  return {
    difference,
    status: difference === 0
      ? "MATCHED"
      : difference < 0
        ? "UNACCOUNTED_STOCK"
        : "OVERAGE",
  };
}

export function validateAuditFilters(query) {
  const filters = {};
  for (const field of ["search", "status", "reason", "auditedBy", "dateFrom", "dateTo"]) {
    if (query[field] === undefined) continue;
    if (typeof query[field] !== "string") {
      return invalid(`Invalid ${field} filter.`);
    }
    filters[field] = query[field].trim();
  }

  if (filters.search && (
    filters.search.length > 160 ||
    /[\u0000-\u001f\u007f]/.test(filters.search)
  )) {
    return invalid("Audit search must be at most 160 characters.");
  }
  if (filters.status && !auditStatuses.has(filters.status)) {
    return invalid("Invalid audit status filter.");
  }
  if (filters.reason && !auditReasons.includes(filters.reason)) {
    return invalid("Invalid audit reason filter.");
  }
  if (filters.auditedBy && !isUuid(filters.auditedBy)) {
    return invalid("Invalid audited-by user ID.");
  }
  for (const field of ["dateFrom", "dateTo"]) {
    if (filters[field] && !isValidDate(filters[field])) {
      return invalid(`Invalid ${field} date filter.`);
    }
  }
  if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) {
    return invalid("Audit date range start must not be after its end.");
  }

  return { valid: true, filters };
}

function parsePhysicalStock(value) {
  if (typeof value === "string") {
    if (!/^\d+$/.test(value.trim())) return null;
    value = Number(value.trim());
  }
  if (typeof value !== "number") return null;
  const parsed = value;
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 2147483647
    ? parsed
    : null;
}

function invalid(error) {
  return { valid: false, error };
}
