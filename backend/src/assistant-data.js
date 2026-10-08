import { databasePool } from "./database.js";
import { productStatusColumns } from "./product-status.js";

export async function loadAssistantFacts(pool = databasePool) {
  const result = await pool.query(
    `WITH bounds AS (
       SELECT CURRENT_DATE AS today,
              CURRENT_DATE - 29 AS sales_start
     ),
     product_status AS (
       SELECT product.*, ${productStatusColumns("product")}
       FROM public.products AS product
     ),
     product_summary AS (
       SELECT count(*) FILTER (WHERE stock_status = 'Low Stock')::integer AS low_stock_count,
              count(*) FILTER (WHERE stock_status = 'Out of Stock')::integer AS out_of_stock_count,
              count(*) FILTER (WHERE expiry_status = 'EXPIRED')::integer AS expired_count,
              count(*) FILTER (
                WHERE expiry_status IN ('EXPIRING_SOON_7_DAYS', 'EXPIRING_30_DAYS')
              )::integer AS expiring_soon_count
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
                )) FILTER (WHERE item.purchase_price_snapshot IS NOT NULL),
                0
              )::numeric(22, 2)::text AS profit,
              count(*) FILTER (
                WHERE item.purchase_price_snapshot IS NULL
              )::integer AS unavailable_cost_items
       FROM public.sales AS sale
       JOIN public.sale_items AS item ON item.sale_id = sale.sale_id
       CROSS JOIN bounds
       WHERE sale.sold_at >= bounds.today
         AND sale.sold_at < bounds.today + interval '1 day'
     ),
     product_sales AS (
       SELECT item.product_id,
              sum(item.quantity)::bigint AS units_sold,
              max(sale.sold_at)::text AS last_sold_at
       FROM public.sales AS sale
       JOIN public.sale_items AS item ON item.sale_id = sale.sale_id
       CROSS JOIN bounds
       WHERE sale.sold_at >= bounds.sales_start
         AND sale.sold_at < bounds.today + interval '1 day'
       GROUP BY item.product_id
     ),
     low_stock AS (
       SELECT product_id, product_name, barcode, current_stock, minimum_stock
       FROM product_status
       WHERE stock_status = 'Low Stock'
       ORDER BY current_stock, product_name
       LIMIT 10
     ),
     out_of_stock AS (
       SELECT product_id, product_name, barcode, current_stock, minimum_stock
       FROM product_status
       WHERE stock_status = 'Out of Stock'
       ORDER BY product_name
       LIMIT 10
     ),
     expiring AS (
       SELECT product_id, product_name, barcode, current_stock,
              expiry_date::text AS expiry_date, expiry_status, days_to_expiry
       FROM product_status
       WHERE expiry_status IN (
         'EXPIRED',
         'EXPIRING_SOON_7_DAYS',
         'EXPIRING_30_DAYS'
       )
       ORDER BY expiry_date, product_name
       LIMIT 10
     ),
     top_products AS (
       SELECT product.product_id, product.product_name, product.barcode,
              product_sales.units_sold, product_sales.last_sold_at
       FROM product_sales
       JOIN public.products AS product USING (product_id)
       ORDER BY product_sales.units_sold DESC, product.product_name
       LIMIT 5
     ),
     slow_products AS (
       SELECT product.product_id, product.product_name, product.barcode,
              product.current_stock,
              COALESCE(product_sales.units_sold, 0)::bigint AS units_sold_last_30_days,
              product_sales.last_sold_at
       FROM public.products AS product
       LEFT JOIN product_sales USING (product_id)
       WHERE product.current_stock > 0
       ORDER BY COALESCE(product_sales.units_sold, 0), product.product_name
       LIMIT 10
     ),
     latest_audits AS (
       SELECT DISTINCT ON (audit.product_id)
              audit.product_id, audit.status, audit.difference, audit.audited_at,
              product.product_name, product.barcode
       FROM public.stock_audits AS audit
       JOIN public.products AS product USING (product_id)
       ORDER BY audit.product_id, audit.audited_at DESC, audit.audit_id DESC
     ),
     stock_mismatches AS (
       SELECT count(*)::integer AS count
       FROM latest_audits
       WHERE status <> 'MATCHED'
     ),
     payment_mismatches AS (
       SELECT count(*)::integer AS count
       FROM public.payment_reconciliations
       WHERE status <> 'PAYMENT_MATCHED'
     )
     SELECT jsonb_build_object(
              'as_of_date', bounds.today::text,
              'sales_window', jsonb_build_object(
                'from', bounds.sales_start::text,
                'through', bounds.today::text
              ),
              'today_sales', jsonb_build_object(
                'sales_count', today_sales.sales_count,
                'revenue', today_sales.revenue,
                'profit', today_profit.profit,
                'profit_cost_basis', 'sale_items.purchase_price_snapshot',
                'unavailable_cost_items', today_profit.unavailable_cost_items
              ),
              'attention_counts', jsonb_build_object(
                'low_stock', product_summary.low_stock_count,
                'out_of_stock', product_summary.out_of_stock_count,
                'expired', product_summary.expired_count,
                'expiring_within_30_days', product_summary.expiring_soon_count,
                'stock_mismatches', stock_mismatches.count,
                'payment_mismatches', payment_mismatches.count
              ),
              'low_stock_products', COALESCE(
                (SELECT jsonb_agg(to_jsonb(low_stock)
                         ORDER BY current_stock, product_name)
                 FROM low_stock),
                '[]'::jsonb
              ),
              'out_of_stock_products', COALESCE(
                (SELECT jsonb_agg(to_jsonb(out_of_stock) ORDER BY product_name)
                 FROM out_of_stock),
                '[]'::jsonb
              ),
              'expiring_products', COALESCE(
                (SELECT jsonb_agg(to_jsonb(expiring)
                         ORDER BY expiry_date, product_name)
                 FROM expiring),
                '[]'::jsonb
              ),
              'top_selling_products_last_30_days', COALESCE(
                (SELECT jsonb_agg(to_jsonb(top_products)
                         ORDER BY units_sold DESC, product_name)
                 FROM top_products),
                '[]'::jsonb
              ),
              'slow_moving_products_last_30_days', COALESCE(
                (SELECT jsonb_agg(to_jsonb(slow_products)
                         ORDER BY units_sold_last_30_days, product_name)
                 FROM slow_products),
                '[]'::jsonb
              ),
              'stock_mismatches', jsonb_build_object(
                'count', stock_mismatches.count,
                'latest_product_audits', COALESCE(
                  (SELECT jsonb_agg(to_jsonb(mismatch)
                           ORDER BY mismatch.audited_at DESC)
                  FROM (
                     SELECT product_id, product_name, barcode, status,
                            difference, audited_at
                     FROM latest_audits
                     WHERE status <> 'MATCHED'
                     ORDER BY audited_at DESC
                     LIMIT 10
                   ) AS mismatch),
                  '[]'::jsonb
                )
              ),
              'payment_mismatches', jsonb_build_object(
                'count', payment_mismatches.count,
                'latest_reconciliations', COALESCE(
                  (SELECT jsonb_agg(to_jsonb(mismatch)
                           ORDER BY mismatch.reconciled_at DESC,
                                    mismatch.reconciliation_id DESC)
                  FROM (
                     SELECT reconciliation_id, period_start::text AS period_start,
                            period_end::text AS period_end, payment_method,
                            difference::text AS difference, status, reconciled_at
                     FROM public.payment_reconciliations
                     WHERE status <> 'PAYMENT_MATCHED'
                     ORDER BY reconciled_at DESC, reconciliation_id DESC
                     LIMIT 10
                   ) AS mismatch),
                  '[]'::jsonb
                )
              )
            ) AS facts
     FROM bounds
     CROSS JOIN today_sales
     CROSS JOIN today_profit
     CROSS JOIN product_summary
     CROSS JOIN stock_mismatches
     CROSS JOIN payment_mismatches`,
  );

  return result.rows[0].facts;
}
