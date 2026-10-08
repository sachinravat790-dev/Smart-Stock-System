const PAYMENT_METHODS = new Set(["CASH", "UPI", "CARD"]);
const MAX_SALE_ITEMS = 100;

export function validateSale(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return invalid("Sale details are required.");
  }

  if (!PAYMENT_METHODS.has(value.payment_method)) {
    return invalid("Select a valid payment method: CASH, UPI, or CARD.");
  }

  if (!Array.isArray(value.items) || value.items.length === 0) {
    return invalid("Add at least one product to the sale.");
  }
  if (value.items.length > MAX_SALE_ITEMS) {
    return invalid(`A sale cannot contain more than ${MAX_SALE_ITEMS} products.`);
  }

  const productIds = new Set();
  const items = [];
  for (const item of value.items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return invalid("Each sale item must include a product ID and quantity.");
    }
    if (!isUuid(item.product_id)) {
      return invalid("Each sale item must have a valid product ID.");
    }
    if (productIds.has(item.product_id)) {
      return invalid("A product can only appear once in the sale. Combine its quantity.");
    }
    productIds.add(item.product_id);

    const quantity = parseQuantity(item.quantity);
    if (quantity === null) {
      return invalid("Sale quantity must be a positive whole number.");
    }
    items.push({ product_id: item.product_id, quantity });
  }

  return {
    valid: true,
    sale: { payment_method: value.payment_method, items },
  };
}

export function isUuid(value) {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function priceToCents(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value);
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fractional = ""] = normalized.split(".");
  return BigInt(whole) * 100n + BigInt(fractional.padEnd(2, "0"));
}

export function centsToAmount(cents) {
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}

function parseQuantity(value) {
  if (typeof value === "string" && !/^\d+$/.test(value.trim())) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 2147483647
    ? parsed
    : null;
}

function invalid(error) {
  return { valid: false, error };
}
