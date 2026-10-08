import { Router } from "express";
import { requireUser } from "./auth-middleware.js";
import { databasePool } from "./database.js";
import { productStatusColumns } from "./product-status.js";

export const dashboardRouter = Router();

dashboardRouter.use(requireUser, requireOwner);

dashboardRouter.get("/", async (_request, response, next) => {
  try {
    const result = await databasePool.query(
      `WITH bounds AS (
         SELECT CURRENT_DATE AS today,
                CURRENT_DATE - 6 AS chart_start
       ),
       product_status AS (
         SELECT product.*, ${productStatusColumns("product")}
         FROM public.products AS product
       ),
       product_summary AS (
         SELECT count(*)::integer AS total_products,
                count(*) FILTER (
                  WHERE stock_status = 'Low Stock'
                )::integer AS low_stock_products,
                count(*) FILTER (
                  WHERE expiry_status = 'EXPIRED'
                )::integer AS expired_products,
                count(*) FILTER (
                  WHERE expiry_status IN (
                    'EXPIRING_SOON_7_DAYS',
                    'EXPIRING_30_DAYS'
                  )
                )::integer AS expiring_soon_products
         FROM product_status
       ),
       today_sales AS (
         SELECT count(*)::integer AS sales_count,
                COALESCE(sum(sale.total_amount), 0)::numeric(22, 2)::text AS revenue
         FROM public.sales AS sale
         CROSS JOIN bounds
         WHERE sale.sold_at >= bounds.today
           AND sale.sold_at < bounds.today + interval '1 day'
       ),
       today_profit AS (
         SELECT COALESCE(
                  sum(item.quantity * (
                    item.unit_price - item.purchase_price_snapshot
                  )),
                  0
                )::numeric(22, 2)::text AS profit
         FROM public.sales AS sale
         JOIN public.sale_items AS item ON item.sale_id = sale.sale_id
         CROSS JOIN bounds
         WHERE sale.sold_at >= bounds.today
           AND sale.sold_at < bounds.today + interval '1 day'
       ),
       unavailable_profit AS (
         SELECT count(*)::integer AS all_time_items,
                count(*) FILTER (
                  WHERE sale.sold_at >= bounds.today
                    AND sale.sold_at < bounds.today + interval '1 day'
                )::integer AS today_items
         FROM public.sale_items AS item
         JOIN public.sales AS sale ON sale.sale_id = item.sale_id
         CROSS JOIN bounds
         WHERE item.purchase_price_snapshot IS NULL
       ),
       days AS (
         SELECT generated_day::date AS day
         FROM bounds,
              generate_series(bounds.chart_start, bounds.today, interval '1 day') generated_day
       ),
       daily_sales AS (
         SELECT sale.sold_at::date AS day,
                count(*)::integer AS sales_count,
                sum(sale.total_amount)::numeric(22, 2)::text AS revenue
         FROM public.sales AS sale
         CROSS JOIN bounds
         WHERE sale.sold_at >= bounds.chart_start
           AND sale.sold_at < bounds.today + interval '1 day'
         GROUP BY sale.sold_at::date
       ),
       latest_audit AS (
         SELECT DISTINCT ON (audit.product_id)
                audit.product_id, audit.status
         FROM public.stock_audits AS audit
         ORDER BY audit.product_id, audit.audited_at DESC, audit.audit_id DESC
       ),
       stock_mismatches AS (
         SELECT count(*)::integer AS count
         FROM latest_audit
         WHERE status <> 'MATCHED'
       ),
       payment_mismatches AS (
         SELECT count(*)::integer AS count
         FROM public.payment_reconciliations
         WHERE status <> 'PAYMENT_MATCHED'
       ),
       low_stock_list AS (
         SELECT product_status.product_id, product_status.product_name,
                product_status.barcode, product_status.current_stock,
                product_status.minimum_stock
         FROM product_status
         WHERE product_status.stock_status = 'Low Stock'
         ORDER BY product_status.current_stock, product_status.product_name
         LIMIT 8
       ),
       expiring_list AS (
         SELECT product_status.product_id, product_status.product_name,
                product_status.barcode, product_status.current_stock,
                product_status.expiry_date::text AS expiry_date,
                product_status.days_to_expiry
         FROM product_status
         WHERE product_status.expiry_status IN (
           'EXPIRED',
           'EXPIRING_SOON_7_DAYS',
           'EXPIRING_30_DAYS'
         )
         ORDER BY product_status.expiry_date, product_status.product_name
         LIMIT 8
       ),
       top_selling AS (
         SELECT product.product_id, product.product_name, product.barcode,
                sum(item.quantity)::bigint AS units_sold,
                sum(item.subtotal)::numeric(22, 2)::text AS revenue
         FROM public.sales AS sale
         JOIN public.sale_items AS item ON item.sale_id = sale.sale_id
         JOIN public.products AS product ON product.product_id = item.product_id
         CROSS JOIN bounds
         WHERE sale.sold_at >= bounds.today - 29
           AND sale.sold_at < bounds.today + interval '1 day'
         GROUP BY product.product_id, product.product_name, product.barcode
         ORDER BY sum(item.quantity) DESC, sum(item.subtotal) DESC,
                  product.product_name
         LIMIT 5
       ),
       recent_activity AS (
         SELECT activity.activity_id, user_row.name AS user_name,
                activity.action_type,
                COALESCE(product.product_name, activity.metadata->>'product_name') AS product_name,
                COALESCE(product.barcode, activity.metadata->>'barcode') AS barcode,
                activity.quantity, activity.created_at
         FROM public.staff_activities AS activity
         JOIN public.users AS user_row ON user_row.id = activity.user_id
         LEFT JOIN public.products AS product ON product.product_id = activity.product_id
         WHERE user_row.role = 'staff'
         ORDER BY activity.created_at DESC, activity.activity_id DESC
         LIMIT 8
       )
       SELECT jsonb_build_object(
                'total_products', product_summary.total_products,
                'today_sales_count', today_sales.sales_count,
                'today_revenue', today_sales.revenue,
                'today_profit', today_profit.profit,
                'today_profit_unavailable_items', unavailable_profit.today_items,
                'historical_profit_unavailable_items', unavailable_profit.all_time_items,
                'low_stock_products', product_summary.low_stock_products,
                'expired_products', product_summary.expired_products,
                'expiring_soon_products', product_summary.expiring_soon_products,
                'stock_mismatch_count', stock_mismatches.count,
                'payment_mismatch_count', payment_mismatches.count,
                'profit_basis', 'current_product_purchase_price'
              ) AS summary,
              COALESCE(
                (SELECT jsonb_agg(jsonb_build_object(
                  'date', to_char(days.day, 'YYYY-MM-DD'),
                  'sales_count', COALESCE(daily_sales.sales_count, 0),
                  'revenue', COALESCE(daily_sales.revenue, '0.00')
                ) ORDER BY days.day)
                 FROM days
                 LEFT JOIN daily_sales USING (day)),
                '[]'::jsonb
              ) AS sales_chart,
              COALESCE(
                (SELECT jsonb_agg(to_jsonb(top_selling)) FROM top_selling),
                '[]'::jsonb
              ) AS top_selling_products,
              COALESCE(
                (SELECT jsonb_agg(to_jsonb(low_stock_list)) FROM low_stock_list),
                '[]'::jsonb
              ) AS low_stock_list,
              COALESCE(
                (SELECT jsonb_agg(to_jsonb(expiring_list)) FROM expiring_list),
                '[]'::jsonb
              ) AS expiring_products,
              COALESCE(
                (SELECT jsonb_agg(to_jsonb(recent_activity)) FROM recent_activity),
                '[]'::jsonb
              ) AS recent_staff_activity
       FROM product_summary
       CROSS JOIN today_sales
       CROSS JOIN today_profit
       CROSS JOIN unavailable_profit
       CROSS JOIN stock_mismatches
       CROSS JOIN payment_mismatches`,
    );
    const dashboard = result.rows[0];
    response.json({
      success: true,
      dashboard: {
        ...dashboard,
        important_alerts: createImportantAlerts(dashboard.summary),
      },
    });
  } catch (error) {
    next(error);
  }
});

function createImportantAlerts(summary) {
  const alerts = [];
  const add = (id, count, title, level = "warning") => {
    if (count > 0) alerts.push({ id, count, title, level });
  };

  add("expired", summary.expired_products, "Products are expired", "critical");
  add("low-stock", summary.low_stock_products, "Products are low on stock");
  add("expiring", summary.expiring_soon_products, "Products expire within 30 days");
  add("stock-mismatch", summary.stock_mismatch_count, "Latest stock audits show mismatches");
  add("payment-mismatch", summary.payment_mismatch_count, "Payment reconciliations show mismatches");
  return alerts;
}

function requireOwner(request, response, next) {
  if (request.authUser.role !== "owner") {
    response.status(403).json({
      success: false,
      error: "Owner access is required to view the dashboard.",
    });
    return;
  }
  next();
}
