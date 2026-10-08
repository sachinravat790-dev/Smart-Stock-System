import { Router } from "express";
import { requireUser } from "./auth-middleware.js";
import { databasePool } from "./database.js";
import {
  isUuid,
  validateLocation,
  validateLocationFilters,
} from "./location-validation.js";
import { productStatusColumns } from "./product-status.js";
import { recordStaffActivity } from "./staff-activity.js";

export const productLocationsRouter = Router();

productLocationsRouter.get("/product-locations", requireUser, async (request, response, next) => {
  const validation = validateLocationFilters(request.query);
  if (!validation.valid) {
    response.status(400).json({ success: false, error: validation.error });
    return;
  }

  const conditions = [];
  const values = [];
  const { search, rack, shelf } = validation.filters;

  if (search) {
    values.push(`%${search.replace(/[\\%_]/g, "\\$&")}%`);
    conditions.push(
      `(product.product_name ILIKE $${values.length} ESCAPE '\\'
        OR COALESCE(product.barcode, '') ILIKE $${values.length} ESCAPE '\\'
        OR COALESCE(product.category, '') ILIKE $${values.length} ESCAPE '\\'
        OR COALESCE(product.brand, '') ILIKE $${values.length} ESCAPE '\\')`,
    );
  }
  if (rack) {
    values.push(`%${rack.replace(/[\\%_]/g, "\\$&")}%`);
    conditions.push(`location.rack_code ILIKE $${values.length} ESCAPE '\\'`);
  }
  if (shelf) {
    values.push(`%${shelf.replace(/[\\%_]/g, "\\$&")}%`);
    conditions.push(`location.shelf_code ILIKE $${values.length} ESCAPE '\\'`);
  }

  try {
    const result = await databasePool.query(
      `SELECT ${productColumns},
              location.location_id,
              location.rack_code,
              location.shelf_code,
              location.location_photo,
              location.updated_at AS location_updated_at
       FROM public.products AS product
       LEFT JOIN public.product_locations AS location
         ON location.product_id = product.product_id AND location.is_current
       ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
       ORDER BY product.product_name ASC, product.created_at DESC`,
      values,
    );
    response.json({ success: true, products: result.rows });
  } catch (error) {
    next(error);
  }
});

productLocationsRouter.get(
  "/products/:productId/location",
  requireUser,
  async (request, response, next) => {
    if (!isUuid(request.params.productId)) {
      response.status(404).json({ success: false, error: "Product not found." });
      return;
    }

    try {
      const result = await databasePool.query(
        `SELECT ${productColumns},
                location.location_id,
                location.rack_code,
                location.shelf_code,
                location.location_photo,
                location.updated_at AS location_updated_at
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

      const row = result.rows[0];
      const location = row.location_id
        ? {
            location_id: row.location_id,
            rack_code: row.rack_code,
            shelf_code: row.shelf_code,
            location_photo: row.location_photo,
            is_current: true,
            updated_at: row.location_updated_at,
          }
        : null;
      response.json({
        success: true,
        found: Boolean(location),
        product: productFromRow(row),
        location,
      });
    } catch (error) {
      next(error);
    }
  },
);

productLocationsRouter.get(
  "/products/:productId/location/history",
  requireUser,
  async (request, response, next) => {
    if (!isUuid(request.params.productId)) {
      response.status(404).json({ success: false, error: "Product not found." });
      return;
    }

    try {
      const product = await databasePool.query(
        "SELECT product_id FROM public.products WHERE product_id = $1",
        [request.params.productId],
      );
      if (!product.rowCount) {
        response.status(404).json({ success: false, error: "Product not found." });
        return;
      }

      const history = await databasePool.query(
        `SELECT history.history_id, history.product_id,
                history.previous_rack_code, history.previous_shelf_code,
                history.new_rack_code, history.new_shelf_code,
                history.changed_at, changed_user.id AS changed_by_id,
                changed_user.name AS changed_by
         FROM public.location_history AS history
         JOIN public.users AS changed_user ON changed_user.id = history.changed_by
         WHERE history.product_id = $1
         ORDER BY history.changed_at DESC, history.history_id DESC`,
        [request.params.productId],
      );
      response.json({ success: true, history: history.rows });
    } catch (error) {
      next(error);
    }
  },
);

productLocationsRouter.put(
  "/products/:productId/location",
  requireUser,
  async (request, response, next) => {
    if (!isUuid(request.params.productId)) {
      response.status(404).json({ success: false, error: "Product not found." });
      return;
    }

    const validation = validateLocation(request.body);
    if (!validation.valid) {
      response.status(400).json({ success: false, error: validation.error });
      return;
    }

    const client = await databasePool.connect();
    try {
      await client.query("BEGIN");

      const product = await client.query(
        "SELECT product_id, product_name, barcode FROM public.products WHERE product_id = $1 FOR UPDATE",
        [request.params.productId],
      );
      if (!product.rowCount) {
        await client.query("ROLLBACK");
        response.status(404).json({ success: false, error: "Product not found." });
        return;
      }

      const current = await client.query(
        `SELECT location_id, rack_code, shelf_code
         FROM public.product_locations
         WHERE product_id = $1 AND is_current
         FOR UPDATE`,
        [request.params.productId],
      );
      const oldLocation = current.rows[0] ?? null;
      const moved = !oldLocation ||
        oldLocation.rack_code !== validation.location.rack_code ||
        oldLocation.shelf_code !== validation.location.shelf_code;

      let location;
      if (oldLocation && !moved) {
        const updated = await client.query(
          `UPDATE public.product_locations
           SET location_photo = $1, updated_at = now()
           WHERE location_id = $2
           RETURNING location_id, rack_code, shelf_code, location_photo,
                     is_current, created_at, updated_at`,
          [validation.location.location_photo, oldLocation.location_id],
        );
        location = updated.rows[0];
      } else {
        if (oldLocation) {
          await client.query(
            `UPDATE public.product_locations
             SET is_current = false, updated_at = now()
             WHERE location_id = $1`,
            [oldLocation.location_id],
          );
        }

        const inserted = await client.query(
          `INSERT INTO public.product_locations (
             product_id, rack_code, shelf_code, location_photo
           ) VALUES ($1, $2, $3, $4)
           RETURNING location_id, rack_code, shelf_code, location_photo,
                     is_current, created_at, updated_at`,
          [
            request.params.productId,
            validation.location.rack_code,
            validation.location.shelf_code,
            validation.location.location_photo,
          ],
        );
        location = inserted.rows[0];

        const history = await client.query(
          `INSERT INTO public.location_history (
             product_id, previous_rack_code, previous_shelf_code,
             new_rack_code, new_shelf_code, changed_by
           ) VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING history_id`,
          [
            request.params.productId,
            oldLocation?.rack_code ?? null,
            oldLocation?.shelf_code ?? null,
            validation.location.rack_code,
            validation.location.shelf_code,
            request.authUser.id,
          ],
        );
        await recordStaffActivity(client, {
          userId: request.authUser.id,
          actionType: "MOVE_PRODUCT",
          productId: request.params.productId,
          referenceType: "LOCATION_HISTORY",
          referenceId: history.rows[0].history_id,
          metadata: {
            product_name: product.rows[0].product_name,
            barcode: product.rows[0].barcode,
            from_rack: oldLocation?.rack_code ?? null,
            from_shelf: oldLocation?.shelf_code ?? null,
            to_rack: validation.location.rack_code,
            to_shelf: validation.location.shelf_code,
          },
        });
      }

      await client.query("COMMIT");
      response.json({
        success: true,
        location,
        changed: moved,
      });
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error(
          "Location transaction rollback failed:",
          rollbackError.code ?? rollbackError.name,
        );
      }
      if (error.code === "23505") {
        response.status(409).json({
          success: false,
          error: "A current location already exists for this product. Refresh and try again.",
        });
        return;
      }
      next(error);
    } finally {
      client.release();
    }
  },
);

const productColumns = `product.product_id, product.product_name, product.barcode,
  product.category, product.brand, product.purchase_price, product.selling_price,
  product.current_stock, product.minimum_stock, product.expiry_date::text AS expiry_date,
  product.product_image, product.created_at, product.updated_at,
  ${productStatusColumns("product")}`;

function productFromRow(row) {
  return Object.fromEntries(
    Object.entries(row).filter(([key]) =>
      ![
        "location_id",
        "rack_code",
        "shelf_code",
        "location_photo",
        "location_updated_at",
      ].includes(key),
    ),
  );
}
