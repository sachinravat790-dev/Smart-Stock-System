import { Router } from "express";
import { requireUser } from "./auth-middleware.js";
import { databasePool } from "./database.js";
import { productStatusColumns } from "./product-status.js";
import {
  calculateAudit,
  validateAudit,
  validateAuditFilters,
} from "./stock-audit-validation.js";
import { isUuid } from "./sales-validation.js";
import { recordStaffActivity } from "./staff-activity.js";

export const stockAuditsRouter = Router();
stockAuditsRouter.use(requireUser, requireOwner);

stockAuditsRouter.get("/summary", async (_request, response, next) => {
  try {
    const result = await databasePool.query(
      `SELECT count(*)::integer AS total_audits,
              (count(*) FILTER (WHERE status = 'MATCHED'))::integer AS matched,
              (count(*) FILTER (WHERE status = 'UNACCOUNTED_STOCK'))::integer AS unaccounted,
              (count(*) FILTER (WHERE status = 'OVERAGE'))::integer AS overage,
              COALESCE(
                sum(-difference) FILTER (WHERE difference < 0),
                0
              )::bigint AS unaccounted_quantity,
              COALESCE(
                sum(difference) FILTER (WHERE difference > 0),
                0
              )::bigint AS overage_quantity
       FROM public.stock_audits`,
    );
    response.json({ success: true, summary: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

stockAuditsRouter.get("/", async (request, response, next) => {
  const validation = validateAuditFilters(request.query);
  if (!validation.valid) {
    response.status(400).json({ success: false, error: validation.error });
    return;
  }
  const limit = request.query.limit === undefined ? 50 : Number(request.query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    response.status(400).json({
      success: false,
      error: "Audit history limit must be between 1 and 100.",
    });
    return;
  }

  const conditions = [];
  const values = [];
  const { search, status, reason, auditedBy, dateFrom, dateTo } = validation.filters;
  if (search) {
    values.push(`%${search.replace(/[\\%_]/g, "\\$&")}%`);
    conditions.push(
      `(product.product_name ILIKE $${values.length} ESCAPE '\\'
        OR COALESCE(product.barcode, '') ILIKE $${values.length} ESCAPE '\\')`,
    );
  }
  for (const [value, expression] of [
    [status, "audit.status ="],
    [reason, "audit.reason ="],
    [auditedBy, "audit.audited_by ="],
  ]) {
    if (!value) continue;
    values.push(value);
    conditions.push(`${expression} $${values.length}`);
  }
  if (dateFrom) {
    values.push(dateFrom);
    conditions.push(`audit.audited_at >= $${values.length}::date`);
  }
  if (dateTo) {
    values.push(dateTo);
    conditions.push(`audit.audited_at < $${values.length}::date + interval '1 day'`);
  }
  values.push(limit);

  try {
    const result = await databasePool.query(
      `SELECT ${auditColumns}
       FROM public.stock_audits AS audit
       JOIN public.products AS product ON product.product_id = audit.product_id
       JOIN public.users AS user_row ON user_row.id = audit.audited_by
       LEFT JOIN public.product_locations AS location
         ON location.product_id = product.product_id AND location.is_current
       ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
       ORDER BY audit.audited_at DESC, audit.audit_id DESC
       LIMIT $${values.length}`,
      values,
    );
    response.json({ success: true, audits: result.rows });
  } catch (error) {
    next(error);
  }
});

stockAuditsRouter.post("/", async (request, response, next) => {
  const validation = validateAudit(request.body);
  if (!validation.valid) {
    response.status(400).json({ success: false, error: validation.error });
    return;
  }

  const client = await databasePool.connect();
  try {
    await client.query("BEGIN");
    const product = await client.query(
      `SELECT product_id, product_name, barcode, current_stock
       FROM public.products
       WHERE product_id = $1
       FOR UPDATE`,
      [validation.audit.product_id],
    );
    if (!product.rowCount) {
      await client.query("ROLLBACK");
      response.status(404).json({ success: false, error: "Product not found." });
      return;
    }

    const expectedStock = product.rows[0].current_stock;
    const physicalStock = validation.audit.physical_stock;
    const { difference, status } = calculateAudit(expectedStock, physicalStock);
    const inserted = await client.query(
      `INSERT INTO public.stock_audits (
         product_id, expected_stock, physical_stock, difference,
         reason, notes, audited_by, status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING audit_id, product_id, expected_stock, physical_stock,
                 difference, reason, notes, audited_by, audited_at, status`,
      [
        validation.audit.product_id,
        expectedStock,
        physicalStock,
        difference,
        validation.audit.reason,
        validation.audit.notes,
        request.authUser.id,
        status,
      ],
    );
    await recordStaffActivity(client, {
      userId: request.authUser.id,
      actionType: "STOCK_AUDIT",
      productId: validation.audit.product_id,
      quantity: difference,
      referenceType: "STOCK_AUDIT",
      referenceId: inserted.rows[0].audit_id,
      metadata: {
        product_name: product.rows[0].product_name,
        barcode: product.rows[0].barcode,
        expected_stock: expectedStock,
        physical_stock: physicalStock,
        difference,
        status,
      },
    });
    await client.query("COMMIT");
    response.status(201).json({
      success: true,
      audit: { ...inserted.rows[0], unaccounted_quantity: Math.max(-difference, 0) },
    });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Stock audit transaction rollback failed:", rollbackError.code ?? rollbackError.name);
    }
    next(error);
  } finally {
    client.release();
  }
});

stockAuditsRouter.get("/:auditId", async (request, response, next) => {
  if (!isUuid(request.params.auditId)) {
    response.status(404).json({ success: false, error: "Audit not found." });
    return;
  }
  try {
    const result = await databasePool.query(
      `SELECT ${auditColumns}
       FROM public.stock_audits AS audit
       JOIN public.products AS product ON product.product_id = audit.product_id
       JOIN public.users AS user_row ON user_row.id = audit.audited_by
       LEFT JOIN public.product_locations AS location
         ON location.product_id = product.product_id AND location.is_current
       WHERE audit.audit_id = $1`,
      [request.params.auditId],
    );
    if (!result.rowCount) {
      response.status(404).json({ success: false, error: "Audit not found." });
      return;
    }
    response.json({ success: true, audit: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

function requireOwner(request, response, next) {
  if (request.authUser.role !== "owner") {
    response.status(403).json({
      success: false,
      error: "Owner access is required to perform or view stock audits.",
    });
    return;
  }
  next();
}

const auditColumns = `audit.audit_id, audit.product_id, product.product_name,
  product.barcode, product.category, product.brand,
  product.current_stock, product.minimum_stock, product.expiry_date::text AS expiry_date,
  ${productStatusColumns("product")},
  location.rack_code, location.shelf_code,
  audit.expected_stock, audit.physical_stock, audit.difference,
  CASE WHEN audit.difference < 0 THEN -audit.difference ELSE 0 END AS unaccounted_quantity,
  CASE WHEN audit.difference > 0 THEN audit.difference ELSE 0 END AS overage_quantity,
  audit.status, audit.reason, audit.notes, audit.audited_by,
  user_row.name AS audited_by_name, audit.audited_at`;
