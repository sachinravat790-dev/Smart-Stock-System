import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "./api.js";

function localDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getPresetRange(preset) {
  const today = new Date();
  const to = localDate(today);
  if (preset === "today") return { dateFrom: to, dateTo: to };
  if (preset === "last-7-days") {
    const from = new Date(today);
    from.setDate(from.getDate() - 6);
    return { dateFrom: localDate(from), dateTo: to };
  }
  const from = new Date(today.getFullYear(), today.getMonth(), 1);
  return { dateFrom: localDate(from), dateTo: to };
}

export default function ReportsPage() {
  const todayRange = useMemo(() => getPresetRange("today"), []);
  const [preset, setPreset] = useState("today");
  const [draft, setDraft] = useState(todayRange);
  const [range, setRange] = useState(todayRange);
  const [topLimit, setTopLimit] = useState(5);
  const [reports, setReports] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshCount, setRefreshCount] = useState(0);

  const query = useMemo(() => {
    const params = new URLSearchParams({
      dateFrom: range.dateFrom,
      dateTo: range.dateTo,
      top: String(topLimit),
    });
    return params.toString();
  }, [range, topLimit]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    apiFetch(`/api/reports?${query}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json().catch(() => ({}));
        if (response.status === 401) {
          throw new Error("Your session has expired. Sign in again.");
        }
        if (!response.ok) {
          throw new Error(result.error || "Could not load reports.");
        }
        setReports(result.reports);
      })
      .catch((loadError) => {
        if (loadError.name !== "AbortError") {
          setError(loadError.message || "Could not load reports.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [query, refreshCount]);

  function selectPreset(value) {
    setPreset(value);
    if (value !== "custom") {
      const selected = getPresetRange(value);
      setDraft(selected);
      setRange(selected);
    }
  }

  function applyCustomRange(event) {
    event.preventDefault();
    if (draft.dateFrom && draft.dateTo && draft.dateFrom <= draft.dateTo) {
      setRange(draft);
    }
  }

  const todayDate = localDate(new Date());
  const customRangeInvalid =
    preset === "custom" &&
    (!draft.dateFrom || !draft.dateTo || draft.dateFrom > draft.dateTo);

  return (
    <div className="reports-page">
      <section className="reports-controls content-card" aria-label="Report filters">
        <div className="reports-heading">
          <div>
            <h2>Reports & Analytics</h2>
            <p>Read-only reports from SmartStock sales, inventory, receiving and audits.</p>
          </div>
          <label className="reports-top-select">
            Top products
            <select
              aria-label="Top products"
              value={topLimit}
              onChange={(event) => setTopLimit(Number(event.target.value))}
            >
              <option value={5}>Top 5</option>
              <option value={10}>Top 10</option>
            </select>
          </label>
        </div>
        <div className="reports-presets" role="group" aria-label="Date range preset">
          {[
            ["today", "Today"],
            ["last-7-days", "Last 7 days"],
            ["this-month", "This month"],
            ["custom", "Custom range"],
          ].map(([value, label]) => (
            <button
              aria-pressed={preset === value}
              className={`reports-preset${preset === value ? " active" : ""}`}
              key={value}
              onClick={() => selectPreset(value)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        {preset === "custom" && (
          <form className="reports-custom-range" onSubmit={applyCustomRange}>
            <label>
              From
              <input
                aria-label="Report start date"
                max={todayDate}
                onChange={(event) => setDraft((current) => ({
                  ...current,
                  dateFrom: event.target.value,
                }))}
                required
                type="date"
                value={draft.dateFrom}
              />
            </label>
            <label>
              To
              <input
                aria-label="Report end date"
                max={todayDate}
                onChange={(event) => setDraft((current) => ({
                  ...current,
                  dateTo: event.target.value,
                }))}
                required
                type="date"
                value={draft.dateTo}
              />
            </label>
            <button className="primary-button reports-apply" disabled={customRangeInvalid}>
              Apply dates
            </button>
            {customRangeInvalid && (
              <span className="reports-validation" role="alert">
                Choose a valid start and end date in order.
              </span>
            )}
          </form>
        )}
        <p className="reports-period">
          Showing {formatDate(range.dateFrom)} – {formatDate(range.dateTo)}
        </p>
      </section>

      {loading && !reports ? (
        <div className="reports-state" role="status">Loading reports…</div>
      ) : error && !reports ? (
        <div className="reports-state reports-error" role="alert">
          <p>{error}</p>
          <button className="secondary-button" onClick={() => setRefreshCount((count) => count + 1)}>
            Try again
          </button>
        </div>
      ) : reports ? (
        <>
          {error && <p className="reports-inline-error" role="alert">{error}</p>}
          {loading && <p className="reports-loading">Updating report…</p>}
          <ReportSummary reports={reports} />
          <section className="reports-grid">
            <ReportPanel title="Daily sales" detail="Sales count and revenue by day">
              <PeriodTable
                rows={reports.daily_sales}
                dateKey="date"
                empty="No sales in this date range."
              />
            </ReportPanel>
            <ReportPanel title="Weekly sales" detail="Weeks begin on Monday">
              <PeriodTable
                rows={reports.weekly_sales}
                dateKey="week_start"
                empty="No weekly sales in this date range."
              />
            </ReportPanel>
            <ReportPanel title="Monthly sales" detail="Calendar-month totals within the selected range">
              <PeriodTable
                rows={reports.monthly_sales}
                dateKey="month_start"
                empty="No monthly sales in this date range."
              />
            </ReportPanel>
            <ReportPanel title={`Top ${topLimit} products`} detail="Ranked by quantity sold in the selected range">
              {reports.top_selling_products.length ? (
                <div className="reports-table-wrap">
                  <table className="reports-table">
                    <thead>
                      <tr><th>Product</th><th>Qty</th><th>Revenue</th></tr>
                    </thead>
                    <tbody>
                      {reports.top_selling_products.map((product) => (
                        <tr key={product.product_id}>
                          <td>
                            <strong>{product.product_name}</strong>
                            {product.barcode && <small>{product.barcode}</small>}
                          </td>
                          <td>{formatCount(product.quantity_sold)}</td>
                          <td>{formatMoney(product.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <ReportEmpty>No products sold in this date range.</ReportEmpty>}
            </ReportPanel>
          </section>
        </>
      ) : null}
    </div>
  );
}

function ReportSummary({ reports }) {
  const { sales, inventory, receiving, stock_mismatch: mismatch } = reports;
  return (
    <>
      <section className="reports-summary-grid" aria-label="Sales and profit summary">
        <SummaryCard label="Total sales" value={formatCount(sales.sales_count)} />
        <SummaryCard label="Total revenue" value={formatMoney(sales.revenue)} />
        <SummaryCard
          label="Total profit"
          value={formatMoney(sales.profit)}
          detail={sales.unavailable_cost_items > 0
            ? `${formatCount(sales.unavailable_cost_items)} sale items lack historical cost`
            : "Sale-time cost snapshots"}
        />
      </section>
      {sales.unavailable_cost_items > 0 && (
        <p className="reports-profit-warning" role="status">
          Profit excludes {formatCount(sales.unavailable_cost_items)} sale items with no historical
          purchase-cost snapshot. No cost estimate is used.
        </p>
      )}
      <section className="reports-summary-grid reports-secondary-grid" aria-label="Inventory receiving and audit summary">
        <SummaryCard label="Products" value={formatCount(inventory.total_products)} />
        <SummaryCard label="Current stock quantity" value={formatCount(inventory.current_quantity)} />
        <SummaryCard label="Inventory value" value={formatMoney(inventory.inventory_value)} detail="Current purchase price × stock" />
        <SummaryCard label="Low stock" value={formatCount(inventory.low_stock_products)} />
        <SummaryCard label="Out of stock" value={formatCount(inventory.out_of_stock_products)} />
        <SummaryCard label="Quantity received" value={formatCount(receiving.quantity_received)} detail={`${formatCount(receiving.receiving_count)} receipts in range`} />
        <SummaryCard label="Receiving value" value={formatMoney(receiving.receiving_value)} />
        <SummaryCard label="Matched audits" value={formatCount(mismatch.matched)} />
        <SummaryCard label="Unaccounted stock" value={formatCount(mismatch.unaccounted_stock)} />
        <SummaryCard label="Overage audits" value={formatCount(mismatch.overage)} />
      </section>
    </>
  );
}

function SummaryCard({ label, value, detail }) {
  return (
    <article className="reports-summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </article>
  );
}

function ReportPanel({ title, detail, children }) {
  return (
    <article className="reports-panel">
      <div className="reports-panel-heading">
        <h2>{title}</h2>
        <p>{detail}</p>
      </div>
      {children}
    </article>
  );
}

function PeriodTable({ rows, dateKey, empty }) {
  if (!rows.length) return <ReportEmpty>{empty}</ReportEmpty>;
  return (
    <div className="reports-table-wrap">
      <table className="reports-table">
        <thead>
          <tr><th>Period</th><th>Sales</th><th>Revenue</th></tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row[dateKey]}>
              <td>{formatDate(row[dateKey])}</td>
              <td>{formatCount(row.sales_count)}</td>
              <td>{formatMoney(row.revenue)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReportEmpty({ children }) {
  return <p className="reports-empty">{children}</p>;
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

function formatDate(value) {
  if (!value) return "—";
  return new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
