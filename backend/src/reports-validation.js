import { isValidDate } from "./product-validation.js";

export function validateReportsQuery(query) {
  if (
    !query ||
    typeof query !== "object" ||
    typeof query.dateFrom !== "string" ||
    typeof query.dateTo !== "string" ||
    !isValidDate(query.dateFrom) ||
    !isValidDate(query.dateTo)
  ) {
    return invalid("Provide a valid report start and end date.");
  }
  if (query.dateFrom > query.dateTo) {
    return invalid("Report start date must not be after its end date.");
  }

  const top = query.top === undefined ? 5 : Number(query.top);
  if (!Number.isInteger(top) || ![5, 10].includes(top)) {
    return invalid("Top-selling product limit must be 5 or 10.");
  }

  return {
    valid: true,
    filters: {
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      top,
    },
  };
}

function invalid(error) {
  return { valid: false, error };
}
