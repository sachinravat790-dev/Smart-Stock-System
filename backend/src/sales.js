import { Router } from "express";
import { requireUser } from "./auth-middleware.js";
import { databasePool } from "./database.js";
import {
  centsToAmount,
  isUuid,
  priceToCents,
  validateSale,
} from "./sales-validation.js";
import { productStatusColumns } from "./product-status.js";
import { recordStaffActivity } from "./staff-activity.js";

export const salesRouter = Router();
salesRouter.use(requireUser);

salesRouter.get("/product/:barcode", async (request, response, next) => {
  const barcode = normalizeBarcode(request.params.barcode);
  if (!barcode) {
    response.status(400).json({ success: false, error: "Enter a valid barcode." });
    return;
  }
  try {
    const result = await databasePool.query(
      `SELECT ${productColumns}
       FROM public.products AS product
       LEFT JOIN public.product_locations AS location
         ON location.product_id = product.product_id AND location.is_current
       WHERE product.barcode = $1`,
      [barcode],
    );
    if (!result.rowCount) {
      response.status(404).json({ success: false, error: "Product not found." });
      return;
    }
    response.json({ success: true, product: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

salesRouter.get("/products", async (request, response, next) => {
  const search = typeof request.query.search === "string"
    ? request.query.search.trim()
    : "";
  if (!search || search.length > 160 || /[\u0000-\u001f\u007f]/.test(search)) {
    response.status(400).json({
      success: false,
      error: "Enter a product search (maximum 160 characters).",
    });
    return;
  }
  try {
    const term = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
    const result = await databasePool.query(
      `SELECT ${productColumns}
       FROM public.products AS product
       LEFT JOIN public.product_locations AS location
         ON location.product_id = product.product_id AND location.is_current
       WHERE product.product_name ILIKE $1 ESCAPE '\\'
          OR COALESCE(product.barcode, '') ILIKE $1 ESCAPE '\\'
          OR COALESCE(product.category, '') ILIKE $1 ESCAPE '\\'
          OR COALESCE(product.brand, '') ILIKE $1 ESCAPE '\\'
       ORDER BY product.product_name ASC
       LIMIT 20`,
      [term],
    );
    response.json({ success: true, products: result.rows });
  } catch (error) {
    next(error);
  }
});

salesRouter.get("/products/:productId", async (request, response, next) => {
  if (!isUuid(request.params.productId)) {
    response.status(404).json({ success: false, error: "Product not found." });
    return;
  }
  try {
    const result = await databasePool.query(
      `SELECT ${productColumns}
       FROM public.products AS product
       LEFT JOIN public.product_locations AS location
         ON location.product_id = product.product_id AND location.is_current
       WHERE product.product_id = $1`,
      [request.params.productId],
    );
    if (!result.rowCount) {
      response.status(404).json({ success: false, error: "Product not found." });
      return;
    }
    response.json({ success: true, product: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

salesRouter.post("/", async (request, response, next) => {
  const validation = validateSale(request.body);
  if (!validation.valid) {
    response.status(400).json({ success: false, error: validation.error });
    return;
  }

  const client = await databasePool.connect();
  try {
    await client.query("BEGIN");

    const ids = validation.sale.items.map(({ product_id }) => product_id).sort();
    const lockedProducts = await client.query(
      `SELECT product_id, product_name, barcode, purchase_price,
              selling_price, current_stock
       FROM public.products
       WHERE product_id = ANY($1::uuid[])
       ORDER BY product_id
       FOR UPDATE`,
      [ids],
    );
    const products = new Map(
      lockedProducts.rows.map((product) => [product.product_id, product]),
    );
    for (const item of validation.sale.items) {
      if (!products.has(item.product_id)) {
        await client.query("ROLLBACK");
        response.status(404).json({
          success: false,
          error: "One or more products were not found.",
        });
        return;
      }
      const product = products.get(item.product_id);
      if (product.current_stock === 0) {
        await client.query("ROLLBACK");
        response.status(409).json({
          success: false,
          error: `Out of stock: ${product.product_name}.`,
        });
        return;
      }
      if (item.quantity > product.current_stock) {
        await client.query("ROLLBACK");
        response.status(409).json({
          success: false,
          error: `Only ${product.current_stock} items available for ${product.product_name}.`,
        });
        return;
      }
      if (priceToCents(product.selling_price) === null) {
        await client.query("ROLLBACK");
        response.status(409).json({
          success: false,
          error: `A valid selling price is unavailable for ${product.product_name}.`,
        });
        return;
      }
    }

    const saleItems = [];
    let totalCents = 0n;
    for (const item of validation.sale.items) {
      const product = products.get(item.product_id);
      const unitPriceCents = priceToCents(product.selling_price);
      const purchasePriceCents = priceToCents(product.purchase_price);
      if (purchasePriceCents === null) {
        await client.query("ROLLBACK");
        response.status(409).json({
          success: false,
          error: `A valid purchase price is unavailable for ${product.product_name}.`,
        });
        return;
      }
      const subtotalCents = unitPriceCents * BigInt(item.quantity);
      totalCents += subtotalCents;
      saleItems.push({
        ...item,
        product_name: product.product_name,
        barcode: product.barcode,
        unit_price: centsToAmount(unitPriceCents),
        purchase_price_snapshot: centsToAmount(purchasePriceCents),
        subtotal: centsToAmount(subtotalCents),
      });
    }
    if (totalCents > 9999999999999999999999n) {
      await client.query("ROLLBACK");
      response.status(400).json({
        success: false,
        error: "Sale total exceeds the supported amount.",
      });
      return;
    }

    const saleResult = await client.query(
      `INSERT INTO public.sales (sold_by, total_amount, payment_method)
       VALUES ($1, $2, $3)
       RETURNING sale_id, sold_by, total_amount, payment_method, sold_at`,
      [
        request.authUser.id,
        centsToAmount(totalCents),
        validation.sale.payment_method,
      ],
    );
    const sale = saleResult.rows[0];

    for (const item of saleItems) {
      await client.query(
        `INSERT INTO public.sale_items (
           sale_id, product_id, quantity, unit_price,
           purchase_price_snapshot, subtotal
         ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          sale.sale_id,
          item.product_id,
          item.quantity,
          item.unit_price,
          item.purchase_price_snapshot,
          item.subtotal,
        ],
      );
    }

    for (const item of [...validation.sale.items].sort((a, b) =>
      a.product_id.localeCompare(b.product_id),
    )) {
      const updated = await client.query(
        `UPDATE public.products
         SET current_stock = current_stock - $1, updated_at = now()
         WHERE product_id = $2 AND current_stock >= $1
         RETURNING current_stock`,
        [item.quantity, item.product_id],
      );
      if (!updated.rowCount) {
        await client.query("ROLLBACK");
        response.status(409).json({
          success: false,
          error: "Stock changed before the sale could be completed. Review the cart and try again.",
        });
        return;
      }
      products.get(item.product_id).current_stock = updated.rows[0].current_stock;
    }

    for (const item of saleItems) {
      await recordStaffActivity(client, {
        userId: request.authUser.id,
        actionType: "SALE",
        productId: item.product_id,
        quantity: item.quantity,
        referenceType: "SALE",
        referenceId: sale.sale_id,
        metadata: {
          product_name: item.product_name,
          barcode: item.barcode,
          payment_method: sale.payment_method,
          item_count: saleItems.length,
          total_amount: sale.total_amount,
        },
      });
    }

    await client.query("COMMIT");
    response.status(201).json({
      success: true,
      sale: {
        ...sale,
        sold_by: request.authUser.name,
        items: saleItems.map((item) => ({
          product_id: item.product_id,
          product_name: item.product_name,
          barcode: item.barcode,
          quantity: item.quantity,
          unit_price: item.unit_price,
          subtotal: item.subtotal,
          current_stock: products.get(item.product_id).current_stock,
        })),
      },
    });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error(
        "Sale transaction rollback failed:",
        rollbackError.code ?? rollbackError.name,
      );
    }
    next(error);
  } finally {
    client.release();
  }
});

salesRouter.get("/history", async (request, response, next) => {
  if (request.authUser.role !== "owner") {
    response.status(403).json({
      success: false,
      error: "Owner access is required to view sales history.",
    });
    return;
  }
  const limit = request.query.limit === undefined ? 50 : Number(request.query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    response.status(400).json({
      success: false,
      error: "Sales history limit must be between 1 and 100.",
    });
    return;
  }
  try {
    const result = await databasePool.query(
      `SELECT sale.sale_id, sale.total_amount, sale.payment_method,
              sale.sold_at, user_row.id AS sold_by_id, user_row.name AS sold_by,
              count(item.sale_item_id)::integer AS item_count
       FROM public.sales AS sale
       JOIN public.users AS user_row ON user_row.id = sale.sold_by
       LEFT JOIN public.sale_items AS item ON item.sale_id = sale.sale_id
       GROUP BY sale.sale_id, user_row.id, user_row.name
       ORDER BY sale.sold_at DESC
       LIMIT $1`,
      [limit],
    );
    response.json({ success: true, sales: result.rows });
  } catch (error) {
    next(error);
  }
});

salesRouter.get("/:saleId", async (request, response, next) => {
  if (request.authUser.role !== "owner") {
    response.status(403).json({
      success: false,
      error: "Owner access is required to view sale details.",
    });
    return;
  }
  if (!isUuid(request.params.saleId)) {
    response.status(404).json({ success: false, error: "Sale not found." });
    return;
  }
  try {
    const saleResult = await databasePool.query(
      `SELECT sale.sale_id, sale.total_amount, sale.payment_method,
              sale.sold_at, user_row.id AS sold_by_id, user_row.name AS sold_by
       FROM public.sales AS sale
       JOIN public.users AS user_row ON user_row.id = sale.sold_by
       WHERE sale.sale_id = $1`,
      [request.params.saleId],
    );
    if (!saleResult.rowCount) {
      response.status(404).json({ success: false, error: "Sale not found." });
      return;
    }
    const items = await databasePool.query(
      `SELECT item.sale_item_id, item.product_id, product.product_name,
              product.barcode, item.quantity, item.unit_price, item.subtotal
       FROM public.sale_items AS item
       JOIN public.products AS product ON product.product_id = item.product_id
       WHERE item.sale_id = $1
       ORDER BY item.created_at, item.sale_item_id`,
      [request.params.saleId],
    );
    response.json({
      success: true,
      sale: { ...saleResult.rows[0], items: items.rows },
    });
  } catch (error) {
    next(error);
  }
});

function normalizeBarcode(value) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim().length > 128 ||
    /[\u0000-\u001f\u007f]/.test(value.trim())
  ) {
    return null;
  }
  return value.trim();
}

const productColumns = `product.product_id, product.product_name, product.barcode,
  product.category, product.brand, product.selling_price, product.current_stock,
  product.minimum_stock, product.expiry_date::text AS expiry_date,
  location.rack_code, location.shelf_code, ${productStatusColumns("product")}`;
