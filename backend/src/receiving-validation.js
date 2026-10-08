import { validateProduct } from "./product-validation.js";

export function validateBarcode(value) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim().length > 128 ||
    /[\u0000-\u001f\u007f]/.test(value.trim())
  ) {
    return { valid: false, error: "Enter a valid barcode (1 to 128 characters)." };
  }

  return { valid: true, barcode: value.trim() };
}

export function validateReceiving(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return invalid("Receiving details are required.");
  }

  const barcode = validateBarcode(value.barcode);
  if (!barcode.valid) return barcode;

  const quantity = positiveQuantity(value.quantity);
  if (quantity === null) {
    return invalid("Received quantity must be a positive whole number.");
  }

  const purchasePrice = nonNegativeMoney(value.purchase_price);
  if (purchasePrice === null) {
    return invalid("Purchase price must be between 0 and 9999999999.99.");
  }

  const supplier = optionalSupplier(value.supplier);
  if (supplier === false) {
    return invalid("Supplier must be at most 160 characters.");
  }

  return {
    valid: true,
    receiving: {
      barcode: barcode.barcode,
      quantity,
      purchase_price: purchasePrice,
      supplier,
    },
  };
}

export function validateNewProductReceiving(value) {
  const receiving = validateReceiving(value);
  if (!receiving.valid) return receiving;

  const product = validateProduct({
    ...value,
    barcode: receiving.receiving.barcode,
    purchase_price: receiving.receiving.purchase_price,
    current_stock: receiving.receiving.quantity,
  });
  if (!product.valid) return product;

  if (!product.product.category || !product.product.brand) {
    return invalid("Category and brand are required for a new product.");
  }

  return {
    valid: true,
    receiving: receiving.receiving,
    product: product.product,
  };
}

function positiveQuantity(value) {
  if (typeof value === "string" && !/^\d+$/.test(value.trim())) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 2147483647
    ? parsed
    : null;
}

function nonNegativeMoney(value) {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    (typeof value === "string" && value.trim() === "")
  ) {
    return null;
  }
  const parsed = Number(value);
  if (
    !Number.isFinite(parsed) ||
    parsed < 0 ||
    parsed > 9999999999.99 ||
    Math.abs(Math.round(parsed * 100) - parsed * 100) > 1e-8
  ) {
    return null;
  }
  return parsed.toFixed(2);
}

function optionalSupplier(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return false;
  const supplier = value.trim();
  if (
    supplier.length > 160 ||
    /[\u0000-\u001f\u007f]/.test(supplier)
  ) {
    return false;
  }
  return supplier || null;
}

function invalid(error) {
  return { valid: false, error };
}
