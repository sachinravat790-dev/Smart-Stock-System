import { Router } from "express";
import { requireUser } from "./auth-middleware.js";
import { databasePool } from "./database.js";
import {
  centsToMoney,
  parseMoneyToCents,
  paymentMethods,
  paymentStatus,
  validateHistoryFilters,
  validateReconciliation,
  validateSummaryFilters,
} from "./payment-reconciliation-validation.js";
import { isUuid } from "./sales-validation.js";
import { recordStaffActivity } from "./staff-activity.js";

export const paymentReconciliationRouter = Router();
paymentReconciliationRouter.use(requireUser, requireOwner);

paymentReconciliationRouter.get("/summary", async (request, response, next) => {
  const validation = validateSummaryFilters(request.query);
  if (!validation.valid) {
    response.status(400).json({ success: false, error: validation.error });
    return;
  }

  const { period_start, period_end } = validation.filters;
  try {
    const result = await databasePool.query(
      `WITH methods(payment_method) AS (
         VALUES ('CASH'::text), ('UPI'::text), ('CARD'::text)
       ),
       expected AS (
         SELECT payment_method, sum(total_amount)::numeric(22, 2) AS amount
         FROM public.sales
         WHERE sold_at >= $1::date
           AND sold_at < $2::date + interval '1 day'
         GROUP BY payment_method
       )
       SELECT methods.payment_method,
              COALESCE(expected.amount, 0)::numeric(22, 2)::text AS expected_amount,
              reconciliation.actual_amount::text AS actual_amount
       FROM methods
       LEFT JOIN expected USING (payment_method)
       LEFT JOIN public.payment_reconciliations AS reconciliation
         ON reconciliation.period_start = $1::date
        AND reconciliation.period_end = $2::date
        AND reconciliation.payment_method = methods.payment_method
       ORDER BY CASE methods.payment_method
         WHEN 'CASH' THEN 1 WHEN 'UPI' THEN 2 ELSE 3 END`,
      [period_start, period_end],
    );
    const methods = result.rows.map((row) => {
      const expectedCents = parseMoneyToCents(row.expected_amount);
      const actualCents = row.actual_amount === null
        ? null
        : parseMoneyToCents(row.actual_amount);
      const difference = actualCents === null ? null : actualCents - expectedCents;
      return {
        ...row,
        difference: difference === null ? null : centsToMoney(difference),
        status: difference === null ? null : paymentStatus(difference),
      };
    });
    const expectedTotal = methods.reduce(
      (total, row) => total + (parseMoneyToCents(row.expected_amount) ?? 0n),
      0n,
    );
    const actualTotal = methods.some((row) => row.actual_amount === null)
      ? null
      : methods.reduce(
          (total, row) => total + (parseMoneyToCents(row.actual_amount) ?? 0n),
          0n,
        );
    const differenceTotal = actualTotal === null ? null : actualTotal - expectedTotal;
    response.json({
      success: true,
      summary: {
        period_start,
        period_end,
        total_recorded_sales: centsToMoney(expectedTotal),
        expected_collection: centsToMoney(expectedTotal),
        actual_collection: actualTotal === null ? null : centsToMoney(actualTotal),
        difference: differenceTotal === null ? null : centsToMoney(differenceTotal),
        status: differenceTotal === null ? null : paymentStatus(differenceTotal),
        payment_methods: methods,
      },
    });
  } catch (error) {
    next(error);
  }
});

paymentReconciliationRouter.get("/staff-summary", async (request, response, next) => {
  const validation = validateSummaryFilters(request.query);
  if (!validation.valid) {
    response.status(400).json({ success: false, error: validation.error });
    return;
  }
  const { period_start, period_end, staff_id, payment_method } = validation.filters;
  try {
    const result = await databasePool.query(
      `SELECT staff.id AS staff_id, staff.name AS staff_name,
              count(sale.sale_id)::integer AS sales_count,
              COALESCE(sum(sale.total_amount), 0)::numeric(22, 2)::text AS total_sales,
              COALESCE(sum(sale.total_amount), 0)::numeric(22, 2)::text AS expected_collection
       FROM public.users AS staff
       LEFT JOIN public.sales AS sale
         ON sale.sold_by = staff.id
        AND sale.sold_at >= $1::date
        AND sale.sold_at < $2::date + interval '1 day'
        AND ($3::text IS NULL OR sale.payment_method = $3)
       WHERE staff.role = 'staff'
         AND ($4::uuid IS NULL OR staff.id = $4)
       GROUP BY staff.id, staff.name
       ORDER BY staff.name`,
      [period_start, period_end, payment_method, staff_id],
    );
    response.json({ success: true, staff: result.rows });
  } catch (error) {
    next(error);
  }
});

paymentReconciliationRouter.get("/history", async (request, response, next) => {
  const validation = validateHistoryFilters(request.query);
  if (!validation.valid) {
    response.status(400).json({ success: false, error: validation.error });
    return;
  }
  const conditions = [];
  const values = [];
  const { dateFrom, dateTo, paymentMethod, status, reconciledBy } = validation.filters;
  if (dateFrom) {
    values.push(dateFrom);
    conditions.push(`reconciliation.period_end >= $${values.length}::date`);
    values.push(dateTo);
    conditions.push(`reconciliation.period_start <= $${values.length}::date`);
  }
  for (const [value, expression] of [
    [paymentMethod, "reconciliation.payment_method ="],
    [status, "reconciliation.status ="],
    [reconciledBy, "reconciliation.reconciled_by ="],
  ]) {
    if (!value) continue;
    values.push(value);
    conditions.push(`${expression} $${values.length}`);
  }
  try {
    const [history, reconcilers] = await Promise.all([
      databasePool.query(
        `SELECT reconciliation.reconciliation_id,
                reconciliation.period_start::text AS period_start,
                reconciliation.period_end::text AS period_end,
                reconciliation.payment_method,
                reconciliation.expected_amount::text AS expected_amount,
                reconciliation.actual_amount::text AS actual_amount,
                reconciliation.difference::text AS difference,
                reconciliation.status,
                reconciliation.reason,
                reconciliation.notes,
                reconciliation.reconciled_by,
                user_row.name AS reconciled_by_name,
                reconciliation.reconciled_at
         FROM public.payment_reconciliations AS reconciliation
         JOIN public.users AS user_row ON user_row.id = reconciliation.reconciled_by
         ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
         ORDER BY reconciliation.period_start DESC,
                  reconciliation.period_end DESC,
                  reconciliation.payment_method`,
        values,
      ),
      databasePool.query(
        `SELECT DISTINCT user_row.id, user_row.name
         FROM public.payment_reconciliations AS reconciliation
         JOIN public.users AS user_row ON user_row.id = reconciliation.reconciled_by
         ORDER BY user_row.name`,
      ),
    ]);
    response.json({
      success: true,
      reconciliations: history.rows,
      reconcilers: reconcilers.rows,
    });
  } catch (error) {
    next(error);
  }
});

paymentReconciliationRouter.post("/", async (request, response, next) => {
  const validation = validateReconciliation(request.body);
  if (!validation.valid) {
    response.status(400).json({ success: false, error: validation.error });
    return;
  }

  const client = await databasePool.connect();
  try {
    await client.query("BEGIN");
    const expected = await client.query(
      `SELECT payment_method, COALESCE(sum(total_amount), 0)::numeric(22, 2)::text AS amount
       FROM public.sales
       WHERE sold_at >= $1::date
         AND sold_at < $2::date + interval '1 day'
       GROUP BY payment_method`,
      [validation.reconciliation.period_start, validation.reconciliation.period_end],
    );
    const expectedByMethod = new Map(
      expected.rows.map((row) => [row.payment_method, row.amount]),
    );
    const inserted = [];
    for (const method of paymentMethods) {
      const expectedCents = parseMoneyToCents(expectedByMethod.get(method) ?? "0.00");
      const actualCents = parseMoneyToCents(
        validation.reconciliation.actual_amounts[method],
      );
      if (expectedCents === null || actualCents === null) {
        throw new Error("Database returned a payment amount outside the supported numeric range.");
      }
      const difference = actualCents - expectedCents;
      const result = await client.query(
        `INSERT INTO public.payment_reconciliations (
           period_start, period_end, payment_method, expected_amount, actual_amount,
           difference, status, reason, notes, reconciled_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING reconciliation_id, period_start::text AS period_start,
                   period_end::text AS period_end, payment_method,
                   expected_amount::text AS expected_amount,
                   actual_amount::text AS actual_amount,
                   difference::text AS difference, status, reason, notes,
                   reconciled_by, reconciled_at`,
        [
          validation.reconciliation.period_start,
          validation.reconciliation.period_end,
          method,
          centsToMoney(expectedCents),
          centsToMoney(actualCents),
          centsToMoney(difference),
          paymentStatus(difference),
          validation.reconciliation.reason,
          validation.reconciliation.notes,
          request.authUser.id,
        ],
      );
      inserted.push(result.rows[0]);
      await recordStaffActivity(client, {
        userId: request.authUser.id,
        actionType: "PAYMENT_RECONCILIATION",
        referenceType: "PAYMENT_RECONCILIATION",
        referenceId: result.rows[0].reconciliation_id,
        metadata: {
          period_start: validation.reconciliation.period_start,
          period_end: validation.reconciliation.period_end,
          payment_method: method,
          expected_amount: centsToMoney(expectedCents),
          actual_amount: centsToMoney(actualCents),
          difference: centsToMoney(difference),
          status: paymentStatus(difference),
        },
      });
    }
    await client.query("COMMIT");
    response.status(201).json({ success: true, reconciliations: inserted });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error(
        "Payment reconciliation transaction rollback failed:",
        rollbackError.code ?? rollbackError.name,
      );
    }
    if (error.code === "23505") {
      response.status(409).json({
        success: false,
        error: "This period has already been reconciled.",
      });
      return;
    }
    next(error);
  } finally {
    client.release();
  }
});

paymentReconciliationRouter.get("/:reconciliationId", async (request, response, next) => {
  if (!isUuid(request.params.reconciliationId)) {
    response.status(404).json({
      success: false,
      error: "Payment reconciliation not found.",
    });
    return;
  }
  try {
    const result = await databasePool.query(
      `SELECT reconciliation.reconciliation_id,
              reconciliation.period_start::text AS period_start,
              reconciliation.period_end::text AS period_end,
              reconciliation.payment_method,
              reconciliation.expected_amount::text AS expected_amount,
              reconciliation.actual_amount::text AS actual_amount,
              reconciliation.difference::text AS difference,
              reconciliation.status,
              reconciliation.reason,
              reconciliation.notes,
              reconciliation.reconciled_by,
              user_row.name AS reconciled_by_name,
              reconciliation.reconciled_at
       FROM public.payment_reconciliations AS reconciliation
       JOIN public.users AS user_row ON user_row.id = reconciliation.reconciled_by
       WHERE reconciliation.reconciliation_id = $1`,
      [request.params.reconciliationId],
    );
    if (!result.rowCount) {
      response.status(404).json({
        success: false,
        error: "Payment reconciliation not found.",
      });
      return;
    }
    response.json({ success: true, reconciliation: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

function requireOwner(request, response, next) {
  if (request.authUser.role !== "owner") {
    response.status(403).json({
      success: false,
      error: "Owner access is required for payment reconciliation.",
    });
    return;
  }
  next();
}
