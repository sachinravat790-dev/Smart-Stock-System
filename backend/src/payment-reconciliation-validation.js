import { isValidDate } from "./product-validation.js";
import { isUuid } from "./sales-validation.js";

export const paymentMethods = Object.freeze(["CASH", "UPI", "CARD"]);

const reconciliationStatuses = new Set([
  "PAYMENT_MATCHED",
  "SHORT_COLLECTION",
  "EXCESS_COLLECTION",
]);

export function validatePeriod(value, fields = ["period_start", "period_end"]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return invalid("A reconciliation period is required.");
  }
  const [startField, endField] = fields;
  const periodStart = value[startField];
  const periodEnd = value[endField];
  if (!isValidDate(periodStart) || !isValidDate(periodEnd)) {
    return invalid("Enter a valid start and end date.");
  }
  if (periodStart > periodEnd) {
    return invalid("Period start date must not be after its end date.");
  }
  return {
    valid: true,
    period: { period_start: periodStart, period_end: periodEnd },
  };
}

export function parseMoneyToCents(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null;
    value = String(value);
  }
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!/^\d{1,20}(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}

export function centsToMoney(cents) {
  const absolute = cents < 0n ? -cents : cents;
  return `${cents < 0n ? "-" : ""}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}

export function paymentStatus(difference) {
  if (difference === 0n) return "PAYMENT_MATCHED";
  return difference < 0n ? "SHORT_COLLECTION" : "EXCESS_COLLECTION";
}

export function validateReconciliation(value) {
  const periodValidation = validatePeriod(value);
  if (!periodValidation.valid) return periodValidation;

  if (!value.actual_amounts || typeof value.actual_amounts !== "object" ||
      Array.isArray(value.actual_amounts)) {
    return invalid("Enter an actual collection amount for CASH, UPI, and CARD.");
  }
  if (Object.keys(value.actual_amounts).some((method) => !paymentMethods.includes(method))) {
    return invalid("Only CASH, UPI, and CARD actual amounts are supported.");
  }

  const actualAmounts = {};
  for (const method of paymentMethods) {
    const amount = parseMoneyToCents(value.actual_amounts[method]);
    if (amount === null) {
      return invalid(`Enter a valid non-negative actual amount for ${method}.`);
    }
    actualAmounts[method] = centsToMoney(amount);
  }

  const reason = optionalText(value.reason, 200, "Reason");
  if (!reason.valid) return reason;
  const notes = optionalText(value.notes, 1000, "Notes");
  if (!notes.valid) return notes;

  return {
    valid: true,
    reconciliation: {
      ...periodValidation.period,
      actual_amounts: actualAmounts,
      reason: reason.value,
      notes: notes.value,
    },
  };
}

export function validateSummaryFilters(query) {
  const periodValidation = validatePeriod(query, ["dateFrom", "dateTo"]);
  if (!periodValidation.valid) return periodValidation;
  if (query.paymentMethod !== undefined &&
      !paymentMethods.includes(query.paymentMethod)) {
    return invalid("Select a valid payment method.");
  }
  if (query.staffId !== undefined && !isUuid(query.staffId)) {
    return invalid("Enter a valid staff ID.");
  }
  return {
    valid: true,
    filters: {
      ...periodValidation.period,
      payment_method: query.paymentMethod ?? null,
      staff_id: query.staffId ?? null,
    },
  };
}

export function validateHistoryFilters(query) {
  const filters = {};
  for (const field of ["dateFrom", "dateTo", "paymentMethod", "status", "reconciledBy"]) {
    if (query[field] !== undefined) {
      if (typeof query[field] !== "string") return invalid(`Invalid ${field} filter.`);
      filters[field] = query[field].trim();
    }
  }
  if (Boolean(filters.dateFrom) !== Boolean(filters.dateTo)) {
    return invalid("Provide both history date range values.");
  }
  if (filters.dateFrom || filters.dateTo) {
    const periodValidation = validatePeriod(filters, ["dateFrom", "dateTo"]);
    if (!periodValidation.valid) return periodValidation;
  }
  if (filters.paymentMethod && !paymentMethods.includes(filters.paymentMethod)) {
    return invalid("Invalid payment method filter.");
  }
  if (filters.status && !reconciliationStatuses.has(filters.status)) {
    return invalid("Invalid payment status filter.");
  }
  if (filters.reconciledBy && !isUuid(filters.reconciledBy)) {
    return invalid("Invalid reconciled-by user ID.");
  }
  return { valid: true, filters };
}

function optionalText(value, maxLength, label) {
  if (value === undefined || value === null || value === "") {
    return { valid: true, value: null };
  }
  if (typeof value !== "string" || value.trim().length > maxLength ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    return invalid(`${label} must be at most ${maxLength} characters and contain no control characters.`);
  }
  return { valid: true, value: value.trim() || null };
}

function invalid(error) {
  return { valid: false, error };
}
