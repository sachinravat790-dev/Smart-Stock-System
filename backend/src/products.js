import { Router } from "express";
import { requireUser } from "./auth-middleware.js";
import { databasePool } from "./database.js";
import { isValidDate, validateProduct } from "./product-validation.js";
import { expiryStatusFilters, productStatusColumns } from "./product-status.js";
import { recordStaffActivity } from "./staff-activity.js";

export const productsRouter = Router();

productsRouter.use(requireUser, (request, response, next) => {
  if (request.authUser.role !== "owner") {
    response.status(403).json({
      success: false,
      error: "Owner access is required to manage inventory.",
    });
    return;
  }
  next();
});

productsRouter.get("/alerts", async (_request, response, next) => {
  try {
    const result = await databasePool.query(
      `SELECT CURRENT_DATE::text AS as_of_date,
              (count(*) FILTER (
                WHERE expiry_date IS NOT NULL AND expiry_date <= CURRENT_DATE
              ))::integer AS expired,
              (count(*) FILTER (
                WHERE expiry_date > CURRENT_DATE
                  AND expiry_date <= CURRENT_DATE + 7
              ))::integer AS expiring_7_days,
              (count(*) FILTER (
                WHERE expiry_date > CURRENT_DATE + 7
                  AND expiry_date <= CURRENT_DATE + 30
              ))::integer AS expiring_30_days,
              (count(*) FILTER (
                WHERE current_stock > 0 AND current_stock <= minimum_stock
              ))::integer AS low_stock,
              (count(*) FILTER (WHERE current_stock = 0))::integer AS out_of_stock
       FROM public.products`,
    );
    response.json({ success: true, alerts: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

productsRouter.get("/", async (request, response, next) => {
  try {
    const filters = [];
    const values = [];

    const search = typeof request.query.search === "string"
      ? request.query.search.trim()
      : "";
    if (search) {
      values.push(`%${search.replace(/[\\%_]/g, "\\$&")}%`);
      filters.push(
        `(product_name ILIKE $${values.length} ESCAPE '\\'
          OR COALESCE(barcode, '') ILIKE $${values.length} ESCAPE '\\'
          OR COALESCE(category, '') ILIKE $${values.length} ESCAPE '\\'
          OR COALESCE(brand, '') ILIKE $${values.length} ESCAPE '\\')`,
      );
    }

    const category = typeof request.query.category === "string"
      ? request.query.category.trim()
      : "";
    if (category) {
      values.push(category);
      filters.push(`category = $${values.length}`);
    }

    if (request.query.stockStatus) {
      const stockSql = {
        "in-stock": "current_stock > minimum_stock",
        "low-stock": "current_stock > 0 AND current_stock <= minimum_stock",
        "out-of-stock": "current_stock = 0",
      }[request.query.stockStatus];
      if (!stockSql) {
        response.status(400).json({
          success: false,
          error: "Invalid stock status filter.",
        });
        return;
      }
      filters.push(stockSql);
    }

    if (request.query.expiryStatus !== undefined) {
      const expiryFilter = typeof request.query.expiryStatus === "string"
        ? expiryStatusFilters[request.query.expiryStatus]
        : null;
      if (!expiryFilter) {
        response.status(400).json({
          success: false,
          error: "Invalid expiry status filter.",
        });
        return;
      }
      filters.push(expiryFilter(""));
    }

    for (const field of ["expiryFrom", "expiryTo"]) {
      if (request.query[field] !== undefined) {
        const value = request.query[field];
        if (typeof value !== "string" || !isValidDate(value)) {
          response.status(400).json({
            success: false,
            error: `Invalid ${field} date filter.`,
          });
          return;
        }
        values.push(value);
        filters.push(`expiry_date ${field === "expiryFrom" ? ">=" : "<="} $${values.length}::date`);
      }
    }

    if (
      request.query.expiryFrom &&
      request.query.expiryTo &&
      request.query.expiryFrom > request.query.expiryTo
    ) {
      response.status(400).json({
        success: false,
        error: "Expiry date range start must not be after its end.",
      });
      return;
    }

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const result = await databasePool.query(
      `SELECT ${productColumns}
       FROM public.products
       ${where}
       ORDER BY
         CASE WHEN $${values.length + 1}::boolean
           THEN expiry_date END ASC NULLS LAST,
         product_name ASC, created_at DESC`,
      [...values, Boolean(request.query.expiryStatus)],
    );
    response.json({ success: true, products: result.rows });
  } catch (error) {
    next(error);
  }
});

productsRouter.post("/", async (request, response, next) => {
  const validation = validateProduct(request.body);
  if (!validation.valid) {
    response.status(400).json({ success: false, error: validation.error });
    return;
  }

  const client = await databasePool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO public.products (
        product_name, barcode, category, brand, purchase_price, selling_price,
        current_stock, minimum_stock, expiry_date, product_image
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING ${productColumns}`,
      productValues(validation.product),
    );
    await recordStaffActivity(client, {
      userId: request.authUser.id,
      actionType: "ADD_PRODUCT",
      productId: result.rows[0].product_id,
      metadata: {
        product_name: result.rows[0].product_name,
        barcode: result.rows[0].barcode,
      },
    });
    await client.query("COMMIT");
    response.status(201).json({ success: true, product: result.rows[0] });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Product creation rollback failed:", rollbackError.code ?? rollbackError.name);
    }
    if (error.code === "23505") {
      response.status(409).json({
        success: false,
        error: "A product with this barcode already exists.",
      });
      return;
    }
    next(error);
  } finally {
    client.release();
  }
});

productsRouter.get("/:productId", async (request, response, next) => {
  if (!isUuid(request.params.productId)) {
    response.status(400).json({ success: false, error: "Invalid product ID." });
    return;
  }

  try {
    const result = await databasePool.query(
      `SELECT ${productColumns}
       FROM public.products
       WHERE product_id = $1`,
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

productsRouter.put("/:productId", async (request, response, next) => {
  if (!isUuid(request.params.productId)) {
    response.status(400).json({ success: false, error: "Invalid product ID." });
    return;
  }
  const validation = validateProduct(request.body);
  if (!validation.valid) {
    response.status(400).json({ success: false, error: validation.error });
    return;
  }

  const client = await databasePool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      "SELECT product_id, product_name, barcode FROM public.products WHERE product_id = $1 FOR UPDATE",
      [request.params.productId],
    );
    if (!existing.rowCount) {
      await client.query("ROLLBACK");
      response.status(404).json({ success: false, error: "Product not found." });
      return;
    }
    const values = productValues(validation.product);
    values.push(request.params.productId);
    const result = await client.query(
      `UPDATE public.products SET
        product_name = $1, barcode = $2, category = $3, brand = $4,
        purchase_price = $5, selling_price = $6, current_stock = $7,
        minimum_stock = $8, expiry_date = $9, product_image = $10,
        updated_at = now()
       WHERE product_id = $11
       RETURNING ${productColumns}`,
      values,
    );
    await recordStaffActivity(client, {
      userId: request.authUser.id,
      actionType: "UPDATE_PRODUCT",
      productId: result.rows[0].product_id,
      metadata: {
        product_name: result.rows[0].product_name,
        barcode: result.rows[0].barcode,
      },
    });
    await client.query("COMMIT");
    response.json({ success: true, product: result.rows[0] });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Product update rollback failed:", rollbackError.code ?? rollbackError.name);
    }
    if (error.code === "23505") {
      response.status(409).json({
        success: false,
        error: "A product with this barcode already exists.",
      });
      return;
    }
    next(error);
  } finally {
    client.release();
  }
});

productsRouter.delete("/:productId", async (request, response, next) => {
  if (!isUuid(request.params.productId)) {
    response.status(400).json({ success: false, error: "Invalid product ID." });
    return;
  }

  try {
    const result = await databasePool.query(
      "DELETE FROM public.products WHERE product_id = $1 RETURNING product_id",
      [request.params.productId],
    );
    if (!result.rowCount) {
      response.status(404).json({ success: false, error: "Product not found." });
      return;
    }
    response.json({ success: true });
  } catch (error) {
    if (error.code === "23503" && error.constraint === "stock_audits_product_id_fkey") {
      response.status(409).json({
        success: false,
        error: "This product has historical stock audits and cannot be deleted.",
      });
      return;
    }
    next(error);
  }
});

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

const productColumns = `product_id, product_name, barcode, category, brand,
  purchase_price, selling_price, current_stock, minimum_stock,
  expiry_date::text AS expiry_date,
  product_image, created_at, updated_at,
  ${productStatusColumns("")}`;

function productValues(product) {
  return [
    product.product_name,
    product.barcode,
    product.category,
    product.brand,
    product.purchase_price,
    product.selling_price,
    product.current_stock,
    product.minimum_stock,
    product.expiry_date,
    product.product_image,
  ];
}
