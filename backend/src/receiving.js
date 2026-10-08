import { Router } from "express";
import { requireUser } from "./auth-middleware.js";
import { databasePool } from "./database.js";
import {
  validateBarcode,
  validateNewProductReceiving,
  validateReceiving,
} from "./receiving-validation.js";
import { productStatusColumns } from "./product-status.js";
import { recordStaffActivity } from "./staff-activity.js";

export const receivingRouter = Router();
receivingRouter.use(requireUser);

receivingRouter.get("/lookup", async (request, response, next) => {
  const validation = validateBarcode(request.query.barcode);
  if (!validation.valid) {
    response.status(400).json({ success: false, error: validation.error });
    return;
  }

  try {
    const result = await databasePool.query(
      `SELECT ${productColumns}
       FROM public.products
       WHERE barcode = $1`,
      [validation.barcode],
    );
    response.json({
      success: true,
      found: Boolean(result.rowCount),
      product: result.rows[0] ?? null,
    });
  } catch (error) {
    next(error);
  }
});

receivingRouter.get("/history", async (request, response, next) => {
  const limit = request.query.limit === undefined ? 50 : Number(request.query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    response.status(400).json({
      success: false,
      error: "History limit must be between 1 and 100.",
    });
    return;
  }

  try {
    const result = await databasePool.query(
      `SELECT
         history.receiving_id,
         history.product_id,
         product.product_name,
         product.barcode,
         history.quantity,
         history.purchase_price,
         history.supplier,
         history.received_at,
         received_user.name AS received_by
       FROM public.receiving_history AS history
       JOIN public.products AS product ON product.product_id = history.product_id
       JOIN public.users AS received_user ON received_user.id = history.received_by
       ORDER BY history.received_at DESC
       LIMIT $1`,
      [limit],
    );
    response.json({ success: true, receivingHistory: result.rows });
  } catch (error) {
    next(error);
  }
});

receivingRouter.post("/", async (request, response, next) => {
  const existingProductId = request.body?.product_id;
  const validation = existingProductId
    ? validateReceiving(request.body)
    : validateNewProductReceiving(request.body);
  if (!validation.valid) {
    response.status(400).json({ success: false, error: validation.error });
    return;
  }

  const client = await databasePool.connect();
  try {
    await client.query("BEGIN");

    let product;
    if (existingProductId) {
      if (!isUuid(existingProductId)) {
        await client.query("ROLLBACK");
        response.status(400).json({ success: false, error: "Invalid product ID." });
        return;
      }

      const existing = await client.query(
        `SELECT product_id, product_name, barcode, category, brand,
                purchase_price, current_stock, minimum_stock, selling_price,
                expiry_date::text AS expiry_date
         FROM public.products
         WHERE product_id = $1 AND barcode = $2
         FOR UPDATE`,
        [existingProductId, validation.receiving.barcode],
      );
      product = existing.rows[0];
      if (!product) {
        await client.query("ROLLBACK");
        response.status(409).json({
          success: false,
          error: "Product no longer matches this barcode. Search the barcode again.",
        });
        return;
      }

      const updated = await client.query(
        `UPDATE public.products
         SET current_stock = current_stock + $1,
             purchase_price = $2,
             updated_at = now()
         WHERE product_id = $3
         RETURNING ${productColumns}`,
        [
          validation.receiving.quantity,
          validation.receiving.purchase_price,
          product.product_id,
        ],
      );
      product = { ...product, ...updated.rows[0] };
    } else {
      const created = await client.query(
        `INSERT INTO public.products (
           product_name, barcode, category, brand, purchase_price, selling_price,
           current_stock, minimum_stock, expiry_date, product_image
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING ${productColumns}`,
        [
          validation.product.product_name,
          validation.product.barcode,
          validation.product.category,
          validation.product.brand,
          validation.receiving.purchase_price,
          validation.product.selling_price,
          validation.receiving.quantity,
          validation.product.minimum_stock,
          validation.product.expiry_date,
          validation.product.product_image,
        ],
      );
      product = created.rows[0];
    }

    const history = await client.query(
      `INSERT INTO public.receiving_history (
         product_id, quantity, purchase_price, supplier, received_by
       ) VALUES ($1, $2, $3, $4, $5)
       RETURNING receiving_id, product_id, quantity, purchase_price,
                 supplier, received_at`,
      [
        product.product_id,
        validation.receiving.quantity,
        validation.receiving.purchase_price,
        validation.receiving.supplier,
        request.authUser.id,
      ],
    );

    await recordStaffActivity(client, {
      userId: request.authUser.id,
      actionType: "RECEIVE_STOCK",
      productId: product.product_id,
      quantity: validation.receiving.quantity,
      referenceType: "RECEIVING",
      referenceId: history.rows[0].receiving_id,
      metadata: {
        product_name: product.product_name,
        barcode: product.barcode,
        purchase_price: validation.receiving.purchase_price,
      },
    });

    await client.query("COMMIT");
    response.status(existingProductId ? 200 : 201).json({
      success: true,
      product,
      receiving: history.rows[0],
    });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Receiving transaction rollback failed:", rollbackError.code ?? rollbackError.name);
    }

    if (error.code === "23505") {
      response.status(409).json({
        success: false,
        error: "A product with this barcode already exists. Search the barcode and receive stock on that product.",
      });
      return;
    }
    next(error);
  } finally {
    client.release();
  }
});

function isUuid(value) {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

const productColumns = `product_id, product_name, barcode, category, brand,
  purchase_price, selling_price, current_stock, minimum_stock,
  expiry_date::text AS expiry_date, product_image, created_at, updated_at,
  ${productStatusColumns("")}`;
