import { Router } from "express";
import { requireUser } from "./auth-middleware.js";
import { databasePool } from "./database.js";
import { productStatusColumns } from "./product-status.js";
import { validateReportsQuery } from "./reports-validation.js";

export const reportsRouter = Router();

reportsRouter.use(requireUser, requireOwner);

reportsRouter.get("/", async (request, response, next) => {
  const validation = validateReportsQuery(request.query);
  if (!validation.valid) {
    response.status(400).json({ success: false, error: validation.error });
    return;
  }

  const { dateFrom, dateTo, top } = validation.filters;
  try {
    const result = await databasePool.query(
      `WITH bounds AS (
         SELECT $1::date AS date_from, $2::date AS date_to
       ),
       period_sales AS (
         SELECT sale.sale_id, sale.total_amount, sale.sold_at
         FROM public.sales AS sale
         CROSS JOIN bounds
         WHERE sale.sold_at >= bounds.date_from
           AND sale.sold_at < bounds.date_to + interval '1 day'
       ),
       sales_summary AS (
         SELECT count(*)::integer AS sales_count,
                COALESCE(sum(total_amount), 0)::numeric(22, 2)::text AS revenue
         FROM period_sales
       ),
       profit_summary AS (
         SELECT COALESCE(
                  sum(item.quantity * (
                    item.unit_price - item.purchase_price_snapshot
                  )) FILTER (WHERE item.purchase_price_snapshot IS NOT NULL),
                  0
                )::numeric(22, 2)::text AS profit,
                count(*) FILTER (
                  WHERE item.purchase_price_snapshot IS NULL
                )::integer AS unavailable_cost_items
         FROM period_sales AS sale
         JOIN public.sale_items AS item ON item.sale_id = sale.sale_id
       ),
       daily_sales AS (
         SELECT (sold_at AT TIME ZONE current_setting('TIMEZONE'))::date AS period,
                count(*)::integer AS sales_count,
                sum(total_amount)::numeric(22, 2)::text AS revenue
         FROM period_sales
         GROUP BY (sold_at AT TIME ZONE current_setting('TIMEZONE'))::date
       ),
       weekly_sales AS (
         SELECT date_trunc(
                  'week',
                  sold_at AT TIME ZONE current_setting('TIMEZONE')
                )::date AS period,
                count(*)::integer AS sales_count,
                sum(total_amount)::numeric(22, 2)::text AS revenue
         FROM period_sales
         GROUP BY date_trunc(
           'week',
           sold_at AT TIME ZONE current_setting('TIMEZONE')
         )::date
       ),
       monthly_sales AS (
         SELECT date_trunc(
                  'month',
                  sold_at AT TIME ZONE current_setting('TIMEZONE')
                )::date AS period,
                count(*)::integer AS sales_count,
                sum(total_amount)::numeric(22, 2)::text AS revenue
         FROM period_sales
         GROUP BY date_trunc(
           'month',
           sold_at AT TIME ZONE current_setting('TIMEZONE')
         )::date
       ),
       product_status AS (
         SELECT product.*, ${productStatusColumns("product")}
         FROM public.products AS product
       ),
       inventory_summary AS (
         SELECT count(*)::integer AS total_products,
                COALESCE(sum(current_stock), 0)::bigint AS current_quantity,
                COALESCE(
                  sum(current_stock * purchase_price),
                  0
                )::numeric(22, 2)::text AS inventory_value,
                count(*) FILTER (
                  WHERE stock_status = 'Low Stock'
                )::integer AS low_stock_products,
                count(*) FILTER (
                  WHERE stock_status = 'Out of Stock'
                )::integer AS out_of_stock_products
         FROM product_status
       ),
       receiving_summary AS (
         SELECT count(*)::integer AS receiving_count,
                COALESCE(sum(receiving.quantity), 0)::bigint AS quantity_received,
                COALESCE(
                  sum(receiving.quantity * receiving.purchase_price),
                  0
                )::numeric(22, 2)::text AS receiving_value
         FROM public.receiving_history AS receiving
         CROSS JOIN bounds
         WHERE receiving.received_at >= bounds.date_from
           AND receiving.received_at < bounds.date_to + interval '1 day'
       ),
       audit_summary AS (
         SELECT count(*) FILTER (
                  WHERE audit.status = 'MATCHED'
                )::integer AS matched,
                count(*) FILTER (
                  WHERE audit.status = 'UNACCOUNTED_STOCK'
                )::integer AS unaccounted_stock,
                count(*) FILTER (
                  WHERE audit.status = 'OVERAGE'
                )::integer AS overage
         FROM public.stock_audits AS audit
         CROSS JOIN bounds
         WHERE audit.audited_at >= bounds.date_from
           AND audit.audited_at < bounds.date_to + interval '1 day'
       ),
       top_products AS (
         SELECT product.product_id, product.product_name, product.barcode,
                sum(item.quantity)::bigint AS quantity_sold,
                sum(item.subtotal)::numeric(22, 2)::text AS revenue
         FROM period_sales AS sale
         JOIN public.sale_items AS item ON item.sale_id = sale.sale_id
         JOIN public.products AS product ON product.product_id = item.product_id
         GROUP BY product.product_id, product.product_name, product.barcode
         ORDER BY sum(item.quantity) DESC, sum(item.subtotal) DESC,
                  product.product_name
         LIMIT $3
       )
       SELECT jsonb_build_object(
                'sales_count', sales_summary.sales_count,
                'revenue', sales_summary.revenue,
                'profit', profit_summary.profit,
                'unavailable_cost_items', profit_summary.unavailable_cost_items
              ) AS sales,
              jsonb_build_object(
                'total_products', inventory_summary.total_products,
                'current_quantity', inventory_summary.current_quantity,
                'inventory_value', inventory_summary.inventory_value,
                'low_stock_products', inventory_summary.low_stock_products,
                'out_of_stock_products', inventory_summary.out_of_stock_products
              ) AS inventory,
              jsonb_build_object(
                'receiving_count', receiving_summary.receiving_count,
                'quantity_received', receiving_summary.quantity_received,
                'receiving_value', receiving_summary.receiving_value
              ) AS receiving,
              jsonb_build_object(
                'matched', audit_summary.matched,
                'unaccounted_stock', audit_summary.unaccounted_stock,
                'overage', audit_summary.overage
              ) AS stock_mismatch,
              COALESCE(
                (SELECT jsonb_agg(jsonb_build_object(
                  'date', period::text,
                  'sales_count', sales_count,
                  'revenue', revenue
                ) ORDER BY period) FROM daily_sales),
                '[]'::jsonb
              ) AS daily_sales,
              COALESCE(
                (SELECT jsonb_agg(jsonb_build_object(
                  'week_start', period::text,
                  'sales_count', sales_count,
                  'revenue', revenue
                ) ORDER BY period) FROM weekly_sales),
                '[]'::jsonb
              ) AS weekly_sales,
              COALESCE(
                (SELECT jsonb_agg(jsonb_build_object(
                  'month_start', period::text,
                  'sales_count', sales_count,
                  'revenue', revenue
                ) ORDER BY period) FROM monthly_sales),
                '[]'::jsonb
              ) AS monthly_sales,
              COALESCE(
                (SELECT jsonb_agg(to_jsonb(top_products)) FROM top_products),
                '[]'::jsonb
              ) AS top_selling_products
       FROM sales_summary
       CROSS JOIN profit_summary
       CROSS JOIN inventory_summary
       CROSS JOIN receiving_summary
       CROSS JOIN audit_summary`,
      [dateFrom, dateTo, top],
    );

    response.json({
      success: true,
      reports: {
        date_from: dateFrom,
        date_to: dateTo,
        top_limit: top,
        ...result.rows[0],
      },
    });
  } catch (error) {
    next(error);
  }
});

function requireOwner(request, response, next) {
  if (request.authUser.role !== "owner") {
    response.status(403).json({
      success: false,
      error: "Owner access is required to view reports.",
    });
    return;
  }
  next();
}
