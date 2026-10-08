export function validateProduct(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return invalid("Product details are required.");
  }

  const productName = requiredText(value.product_name, 160);
  if (!productName) return invalid("Product name is required (maximum 160 characters).");

  const barcode = optionalText(value.barcode, 128);
  if (barcode === false) return invalid("Barcode must be at most 128 characters and contain no control characters.");

  const category = optionalText(value.category, 100);
  if (category === false) return invalid("Category must be at most 100 characters.");

  const brand = optionalText(value.brand, 100);
  if (brand === false) return invalid("Brand must be at most 100 characters.");

  const purchasePrice = nonNegativeMoney(value.purchase_price ?? 0);
  if (purchasePrice === null) return invalid("Purchase price must be between 0 and 9999999999.99.");

  const sellingPrice = nonNegativeMoney(value.selling_price ?? 0);
  if (sellingPrice === null) return invalid("Selling price must be between 0 and 9999999999.99.");

  const currentStock = nonNegativeInteger(value.current_stock ?? 0);
  if (currentStock === null) return invalid("Current stock must be a non-negative whole number.");

  const minimumStock = nonNegativeInteger(value.minimum_stock ?? 0);
  if (minimumStock === null) return invalid("Minimum stock must be a non-negative whole number.");

  const expiryDate = value.expiry_date === undefined ||
    value.expiry_date === "" ||
    value.expiry_date === null
    ? null
    : value.expiry_date;
  if (expiryDate !== null && !isValidDate(expiryDate)) {
    return invalid("Expiry date must be a valid YYYY-MM-DD date.");
  }

  const productImage = value.product_image === undefined ||
    value.product_image === "" ||
    value.product_image === null
    ? null
    : value.product_image;
  if (
    productImage !== null &&
    (typeof productImage !== "string" ||
      productImage.length > 2048 ||
      !/^https?:\/\/[^\s]+$/i.test(productImage) ||
      !isHttpUrl(productImage))
  ) {
    return invalid("Product image must be an HTTP or HTTPS URL up to 2048 characters.");
  }

  return {
    valid: true,
    product: {
      product_name: productName,
      barcode,
      category,
      brand,
      purchase_price: purchasePrice,
      selling_price: sellingPrice,
      current_stock: currentStock,
      minimum_stock: minimumStock,
      expiry_date: expiryDate,
      product_image: productImage,
    },
  };
}

export function isValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function stockStatus(currentStock, minimumStock) {
  if (currentStock === 0) return "Out of Stock";
  if (currentStock <= minimumStock) return "Low Stock";
  return "In Stock";
}

function requiredText(value, maximum) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length >= 1 && normalized.length <= maximum ? normalized : null;
}

function optionalText(value, maximum) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return false;
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum || /[\u0000-\u001f\u007f]/.test(normalized)) {
    return false;
  }
  return normalized;
}

function nonNegativeMoney(value) {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    (typeof value === "string" && value.trim() === "")
  ) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 9999999999.99) return null;
  if (Math.abs(Math.round(parsed * 100) - parsed * 100) > 1e-8) return null;
  return parsed.toFixed(2);
}

function nonNegativeInteger(value) {
  if (typeof value === "string" && value.trim() === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function invalid(error) {
  return { valid: false, error };
}
