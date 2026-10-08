import { Router } from "express";
import { requireUser } from "./auth-middleware.js";
import { databasePool } from "./database.js";
import { isValidDate } from "./product-validation.js";
import { isUuid } from "./sales-validation.js";

export const staffActivitiesRouter = Router();
staffActivitiesRouter.use(requireUser, requireOwner);

staffActivitiesRouter.get("/summary", async (request, response, next) => {
  const validation = validateActivityFilters(request.query, { pagination: false });
  if (!validation.valid) {
    response.status(400).json({ success: false, error: validation.error });
    return;
  }
  const { dateFrom, dateTo } = validation.filters;
  const values = [];
  const predicates = ["user_row.role = 'staff'"];
  if (dateFrom) {
    values.push(dateFrom);
    predicates.push(`activity.created_at >= $${values.length}::date`);
  }
  if (dateTo) {
    values.push(dateTo);
    predicates.push(`activity.created_at < $${values.length}::date + interval '1 day'`);
  }
  try {
    const result = await databasePool.query(
      `SELECT user_row.id AS user_id, user_row.name AS user_name,
              count(activity.activity_id)::integer AS total_activities,
              count(*) FILTER (WHERE activity.action_type = 'SALE')::integer AS sales,
              count(*) FILTER (WHERE activity.action_type = 'RECEIVE_STOCK')::integer AS receiving,
              count(*) FILTER (WHERE activity.action_type = 'MOVE_PRODUCT')::integer AS location_moves,
              count(*) FILTER (WHERE activity.action_type = 'STOCK_AUDIT')::integer AS audits
       FROM public.users AS user_row
       LEFT JOIN public.staff_activities AS activity
         ON activity.user_id = user_row.id
         ${dateFrom ? `AND activity.created_at >= $1::date` : ""}
         ${dateTo ? `AND activity.created_at < $${dateFrom ? 2 : 1}::date + interval '1 day'` : ""}
       WHERE user_row.role = 'staff'
       GROUP BY user_row.id, user_row.name
       ORDER BY user_row.name`,
      values,
    );
    response.json({ success: true, summary: result.rows });
  } catch (error) {
    next(error);
  }
});

staffActivitiesRouter.get("/", async (request, response, next) => {
  const validation = validateActivityFilters(request.query);
  if (!validation.valid) {
    response.status(400).json({ success: false, error: validation.error });
    return;
  }
  const { userId, actionType, productSearch, dateFrom, dateTo, referenceType, referenceId, page, limit } =
    validation.filters;
  const values = [];
  const predicates = [];
  if (userId) {
    values.push(userId);
    predicates.push(`activity.user_id = $${values.length}`);
  }
  if (actionType) {
    values.push(actionType);
    predicates.push(`activity.action_type = $${values.length}`);
  }
  if (productSearch) {
    values.push(`%${productSearch.replace(/[\\%_]/g, "\\$&")}%`);
    predicates.push(
      `(COALESCE(product.product_name, activity.metadata->>'product_name', '') ILIKE $${values.length} ESCAPE '\\'
        OR COALESCE(product.barcode, activity.metadata->>'barcode', '') ILIKE $${values.length} ESCAPE '\\')`,
    );
  }
  if (dateFrom) {
    values.push(dateFrom);
    predicates.push(`activity.created_at >= $${values.length}::date`);
  }
  if (dateTo) {
    values.push(dateTo);
    predicates.push(`activity.created_at < $${values.length}::date + interval '1 day'`);
  }
  if (referenceType) {
    values.push(referenceType);
    predicates.push(`activity.reference_type = $${values.length}`);
  }
  if (referenceId) {
    values.push(referenceId);
    predicates.push(`activity.reference_id = $${values.length}`);
  }
  const filterValues = [...values];
  values.push(limit);
  const limitParameter = values.length;
  values.push((page - 1) * limit);
  const offsetParameter = values.length;
  const where = predicates.length ? `WHERE ${predicates.join(" AND ")}` : "";

  try {
    const [countResult, result] = await Promise.all([
      databasePool.query(
        `SELECT count(*)::integer AS total
         FROM public.staff_activities AS activity
         JOIN public.users AS user_row ON user_row.id = activity.user_id
         LEFT JOIN public.products AS product ON product.product_id = activity.product_id
         ${where}`,
        filterValues,
      ),
      databasePool.query(
      `SELECT activity.activity_id, activity.user_id, user_row.name AS user_name,
              user_row.role AS user_role, activity.action_type, activity.product_id,
              COALESCE(product.product_name, activity.metadata->>'product_name') AS product_name,
              COALESCE(product.barcode, activity.metadata->>'barcode') AS barcode,
              activity.quantity, activity.reference_type, activity.reference_id,
              activity.metadata, activity.created_at,
              count(*) OVER()::integer AS total
       FROM public.staff_activities AS activity
       JOIN public.users AS user_row ON user_row.id = activity.user_id
       LEFT JOIN public.products AS product ON product.product_id = activity.product_id
       ${where}
       ORDER BY activity.created_at DESC, activity.activity_id DESC
       LIMIT $${limitParameter} OFFSET $${offsetParameter}`,
      values,
      ),
    ]);
    const total = countResult.rows[0].total;
    response.json({
      success: true,
      activities: result.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      users: await listUsers(),
    });
  } catch (error) {
    next(error);
  }
});

staffActivitiesRouter.get("/:activityId", async (request, response, next) => {
  if (!isUuid(request.params.activityId)) {
    response.status(404).json({ success: false, error: "Activity not found." });
    return;
  }
  try {
    const result = await databasePool.query(
      `SELECT activity.activity_id, activity.user_id, user_row.name AS user_name,
              user_row.role AS user_role, activity.action_type, activity.product_id,
              COALESCE(product.product_name, activity.metadata->>'product_name') AS product_name,
              COALESCE(product.barcode, activity.metadata->>'barcode') AS barcode,
              activity.quantity, activity.reference_type, activity.reference_id,
              activity.metadata, activity.created_at
       FROM public.staff_activities AS activity
       JOIN public.users AS user_row ON user_row.id = activity.user_id
       LEFT JOIN public.products AS product ON product.product_id = activity.product_id
       WHERE activity.activity_id = $1`,
      [request.params.activityId],
    );
    if (!result.rowCount) {
      response.status(404).json({ success: false, error: "Activity not found." });
      return;
    }
    response.json({ success: true, activity: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

async function listUsers() {
  const result = await databasePool.query(
    "SELECT id, name, role FROM public.users ORDER BY role, name",
  );
  return result.rows;
}

export function validateActivityFilters(query, { pagination = true } = {}) {
  const filters = {};
  const stringFields = [
    ["userId", 36],
    ["actionType", 40],
    ["productSearch", 160],
    ["dateFrom", 10],
    ["dateTo", 10],
    ["referenceType", 80],
    ["referenceId", 160],
  ];
  for (const [field, max] of stringFields) {
    if (query[field] === undefined) continue;
    if (typeof query[field] !== "string" || query[field].trim().length > max) {
      return invalid(`Invalid ${field} filter.`);
    }
    filters[field] = query[field].trim();
    if (/[\u0000-\u001f\u007f]/.test(filters[field])) {
      return invalid(`Invalid ${field} filter.`);
    }
  }
  if (filters.userId && !isUuid(filters.userId)) {
    return invalid("Invalid user filter.");
  }
  if (filters.actionType && !actionTypes.has(filters.actionType)) {
    return invalid("Invalid activity action filter.");
  }
  if (filters.dateFrom && !isValidDate(filters.dateFrom)) {
    return invalid("Invalid start date.");
  }
  if (filters.dateTo && !isValidDate(filters.dateTo)) {
    return invalid("Invalid end date.");
  }
  if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) {
    return invalid("Start date must not be after end date.");
  }
  if ((filters.referenceType && !filters.referenceId) ||
      (!filters.referenceType && filters.referenceId)) {
    return invalid("Provide both reference type and reference ID.");
  }
  if (pagination) {
    const page = query.page === undefined ? 1 : Number(query.page);
    const limit = query.limit === undefined ? 25 : Number(query.limit);
    if (!Number.isSafeInteger(page) || page < 1 || page > 1000000 ||
        !Number.isInteger(limit) || limit < 1 || limit > 100) {
      return invalid("Page must be a positive integer and limit must be between 1 and 100.");
    }
    filters.page = page;
    filters.limit = limit;
  }
  return { valid: true, filters };
}

const actionTypes = new Set([
  "LOGIN",
  "LOGOUT",
  "RECEIVE_STOCK",
  "ADD_PRODUCT",
  "UPDATE_PRODUCT",
  "MOVE_PRODUCT",
  "SALE",
  "STOCK_AUDIT",
  "PAYMENT_RECONCILIATION",
]);

function requireOwner(request, response, next) {
  if (request.authUser.role !== "owner") {
    response.status(403).json({
      success: false,
      error: "Owner access is required to view staff activity.",
    });
    return;
  }
  next();
}

function invalid(error) {
  return { valid: false, error };
}
