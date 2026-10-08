import { useEffect, useState } from "react";
import { apiFetch } from "./api.js";

export default function DashboardPage() {
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadDashboard(signal) {
    setLoading(true);
    setError("");
    try {
      const response = await apiFetch("/api/dashboard", {
        signal,
      });
      const result = await response.json().catch(() => ({}));
      if (response.status === 401) {
        throw new Error("Your session has expired. Sign in again.");
      }
      if (!response.ok) {
        throw new Error(result.error || "Could not load the Owner Dashboard.");
      }
      if (!result.dashboard?.summary) {
        throw new Error("The dashboard response was incomplete.");
      }
      setDashboard(result.dashboard);
    } catch (loadError) {
      if (loadError.name !== "AbortError") {
        setError(loadError.message || "Could not load the Owner Dashboard.");
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    loadDashboard(controller.signal);
    return () => controller.abort();
  }, []);

  if (loading && !dashboard) {
    return <div className="dashboard-state" role="status">Loading dashboard data…</div>;
  }
  if (error && !dashboard) {
    return (
      <div className="dashboard-state dashboard-error" role="alert">
        <p>{error}</p>
        <button className="dashboard-retry" onClick={() => loadDashboard()}>
          Try again
        </button>
      </div>
    );
  }

  const data = dashboard;
  const { summary } = data;

  return (
    <div className="dashboard">
      {error && <p className="dashboard-inline-error" role="alert">{error}</p>}
      <section className="dashboard-metrics" aria-label="Today's shop summary">
        <Metric label="Total products" value={formatCount(summary.total_products)} />
        <Metric label="Today's sales" value={formatCount(summary.today_sales_count)} />
        <Metric label="Today's revenue" value={formatMoney(summary.today_revenue)} />
        <Metric
          label="Today's Profit"
          value={formatMoney(summary.today_profit)}
          detail={summary.today_profit_unavailable_items
            ? `${formatCount(summary.today_profit_unavailable_items)} sale items lack historical cost`
            : "Based on sale-time cost snapshots"}
        />
        <Metric label="Low stock" value={formatCount(summary.low_stock_products)} tone="warning" />
        <Metric label="Expired" value={formatCount(summary.expired_products)} tone="danger" />
        <Metric label="Expiring soon" value={formatCount(summary.expiring_soon_products)} tone="warning" />
        <Metric label="Stock mismatches" value={formatCount(summary.stock_mismatch_count)} tone="warning" />
        <Metric label="Payment mismatches" value={formatCount(summary.payment_mismatch_count)} tone="warning" />
      </section>

      {summary.historical_profit_unavailable_items > 0 && (
        <p className="dashboard-profit-warning" role="status">
          Historical profit is unavailable for {formatCount(summary.historical_profit_unavailable_items)}
          {" "}older sale items because their sale-time purchase cost was not recorded.
          Those items are excluded from profit totals.
        </p>
      )}

      <section className="dashboard-grid">
        <article className="dashboard-panel dashboard-chart-panel">
          <PanelHeading title="Sales & revenue" detail="Last 7 days, including today" />
          {data.sales_chart.length ? (
            <SalesChart days={data.sales_chart} />
          ) : (
            <EmptyState>Sales activity will appear here.</EmptyState>
          )}
        </article>

        <article className="dashboard-panel">
          <PanelHeading title="Important alerts" detail="Live stock, expiry and reconciliation signals" />
          {data.important_alerts.length ? (
            <ul className="dashboard-alert-list">
              {data.important_alerts.map((alert) => (
                <li className={`dashboard-alert ${alert.level}`} key={alert.id}>
                  <span className="dashboard-alert-count">{formatCount(alert.count)}</span>
                  <span>{alert.title}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState>No important alerts right now.</EmptyState>
          )}
        </article>

        <article className="dashboard-panel">
          <PanelHeading title="Top-selling products" detail="By units sold in the last 30 days" />
          {data.top_selling_products.length ? (
            <div className="dashboard-list">
              {data.top_selling_products.map((product) => (
                <div className="dashboard-list-row" key={product.product_id}>
                  <ProductLabel name={product.product_name} barcode={product.barcode} />
                  <span className="dashboard-row-value">
                    {formatCount(product.units_sold)} sold
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState>No sales recorded in the last 30 days.</EmptyState>
          )}
        </article>

        <article className="dashboard-panel">
          <PanelHeading title="Low-stock products" detail="Positive stock at or below minimum" />
          {data.low_stock_list.length ? (
            <div className="dashboard-list">
              {data.low_stock_list.map((product) => (
                <div className="dashboard-list-row" key={product.product_id}>
                  <ProductLabel name={product.product_name} barcode={product.barcode} />
                  <span className="dashboard-row-value stock-warning">
                    {product.current_stock} / {product.minimum_stock}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState>No low-stock products.</EmptyState>
          )}
        </article>

        <article className="dashboard-panel">
          <PanelHeading title="Expiring products" detail="Expired or expiring within 30 days" />
          {data.expiring_products.length ? (
            <div className="dashboard-list">
              {data.expiring_products.map((product) => (
                <div className="dashboard-list-row" key={product.product_id}>
                  <ProductLabel name={product.product_name} barcode={product.barcode} />
                  <span className={`dashboard-row-value ${product.days_to_expiry < 0 ? "stock-danger" : "stock-warning"}`}>
                    {product.days_to_expiry < 0
                      ? `Expired ${Math.abs(product.days_to_expiry)}d ago`
                      : product.days_to_expiry === 0
                        ? "Expires today"
                        : `${product.days_to_expiry}d`}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState>No expired or soon-to-expire products.</EmptyState>
          )}
        </article>

        <article className="dashboard-panel dashboard-activity-panel">
          <PanelHeading title="Recent staff activity" detail="Latest actions recorded by the activity trail" />
          {data.recent_staff_activity.length ? (
            <div className="dashboard-list">
              {data.recent_staff_activity.map((activity) => (
                <div className="dashboard-list-row" key={activity.activity_id}>
                  <div className="dashboard-activity-copy">
                    <strong>{actionLabel(activity.action_type)}</strong>
                    <span>
                      {activity.user_name}
                      {activity.product_name ? ` · ${activity.product_name}` : ""}
                      {activity.quantity !== null ? ` · ${activity.quantity}` : ""}
                    </span>
                  </div>
                  <time dateTime={activity.created_at}>{formatDateTime(activity.created_at)}</time>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState>No staff activity recorded yet.</EmptyState>
          )}
        </article>
      </section>

      {summary.today_profit_unavailable_items > 0 && (
        <p className="dashboard-footnote">
          Today's profit includes only sale items with a stored historical purchase cost.
        </p>
      )}
    </div>
  );
}

function Metric({ label, value, detail, tone = "" }) {
  return (
    <article className={`dashboard-metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </article>
  );
}

function PanelHeading({ title, detail }) {
  return (
    <div className="dashboard-panel-heading">
      <h2>{title}</h2>
      <p>{detail}</p>
    </div>
  );
}

function EmptyState({ children }) {
  return <p className="dashboard-empty">{children}</p>;
}

function ProductLabel({ name, barcode }) {
  return (
    <span className="dashboard-product-label">
      <strong>{name}</strong>
      {barcode && <small>{barcode}</small>}
    </span>
  );
}

function SalesChart({ days }) {
  const width = 660;
  const height = 210;
  const padding = { top: 16, right: 16, bottom: 36, left: 16 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maxRevenue = Math.max(...days.map((day) => Number(day.revenue) || 0), 1);
  const points = days.map((day, index) => {
    const x = padding.left + (days.length === 1 ? chartWidth / 2 : index * chartWidth / (days.length - 1));
    const y = padding.top + chartHeight - (Number(day.revenue) || 0) / maxRevenue * chartHeight;
    return `${x},${y}`;
  }).join(" ");

  return (
    <div className="dashboard-chart">
      <div className="dashboard-chart-legend">
        <span><i className="chart-dot" /> Revenue</span>
        <span>Sales count shown under each day</span>
      </div>
      <svg
        aria-label="Revenue by day for the last 7 days"
        className="dashboard-chart-svg"
        role="img"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
      >
        {[0, 0.5, 1].map((fraction) => {
          const y = padding.top + fraction * chartHeight;
          return <line key={fraction} x1={padding.left} x2={width - padding.right} y1={y} y2={y} className="chart-gridline" />;
        })}
        <polyline points={points} className="chart-line" />
        {days.map((day, index) => {
          const x = padding.left + (days.length === 1 ? chartWidth / 2 : index * chartWidth / (days.length - 1));
          const y = padding.top + chartHeight - (Number(day.revenue) || 0) / maxRevenue * chartHeight;
          return (
            <g key={day.date}>
              <circle cx={x} cy={y} r="4" className="chart-point" />
              <title>
                {`${formatChartDate(day.date)}: ${formatMoney(day.revenue)} revenue, ${formatCount(day.sales_count)} sales`}
              </title>
              <text x={x} y={height - 18} textAnchor="middle" className="chart-label">
                {formatChartDate(day.date)}
              </text>
              <text x={x} y={height - 4} textAnchor="middle" className="chart-count">
                {day.sales_count}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function formatCount(value) {
  return Number(value ?? 0).toLocaleString();
}

function formatMoney(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(value ?? 0));
}

function formatChartDate(value) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function actionLabel(action) {
  return {
    LOGIN: "Signed in",
    LOGOUT: "Signed out",
    RECEIVE_STOCK: "Received stock",
    ADD_PRODUCT: "Added product",
    UPDATE_PRODUCT: "Updated product",
    MOVE_PRODUCT: "Moved product",
    SALE: "Completed sale",
    STOCK_AUDIT: "Recorded stock audit",
    PAYMENT_RECONCILIATION: "Reconciled payments",
  }[action] ?? action;
}
