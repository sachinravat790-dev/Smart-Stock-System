import { useEffect, useState } from "react";
import { apiFetch } from "./api.js";

const alertFilters = [
  {
    id: "expired",
    label: "Expired",
    key: "expired",
    params: { expiryStatus: "expired" },
  },
  {
    id: "expiring-7-days",
    label: "Expiring in 1–7 days",
    key: "expiring_7_days",
    params: { expiryStatus: "expiring-7-days" },
  },
  {
    id: "expiring-30-days",
    label: "Expiring in 8–30 days",
    key: "expiring_30_days",
    params: { expiryStatus: "expiring-30-days" },
  },
  {
    id: "low-stock",
    label: "Low Stock",
    key: "low_stock",
    params: { stockStatus: "low-stock" },
  },
  {
    id: "out-of-stock",
    label: "Out of Stock",
    key: "out_of_stock",
    params: { stockStatus: "out-of-stock" },
  },
];

const statusLabels = {
  EXPIRED: "Expired",
  EXPIRING_SOON_7_DAYS: "Expiring in 7 days",
  EXPIRING_30_DAYS: "Expiring in 8–30 days",
  SAFE: "Safe",
  NO_EXPIRY_DATE: "No expiry date",
};

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function displayDate(value) {
  if (!value) return "—";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(date.valueOf())
    ? "—"
    : date.toLocaleDateString(undefined, { timeZone: "UTC" });
}

function daysLabel(value) {
  if (value === null || value === undefined) return "—";
  if (value < 0) return `Expired ${Math.abs(value)} ${Math.abs(value) === 1 ? "day" : "days"} ago`;
  if (value === 0) return "Expires today";
  return `${value} ${value === 1 ? "day" : "days"}`;
}

function expiryClass(status) {
  return {
    EXPIRED: "expiry-expired",
    EXPIRING_SOON_7_DAYS: "expiry-soon",
    EXPIRING_30_DAYS: "expiry-upcoming",
    SAFE: "expiry-safe",
  }[status] || "expiry-none";
}

function stockClass(status) {
  return {
    "In Stock": "stock-in",
    "Low Stock": "stock-low",
    "Out of Stock": "stock-out",
  }[status];
}

export default function ExpiryAlertsPage() {
  const [summary, setSummary] = useState(null);
  const [products, setProducts] = useState([]);
  const [selectedId, setSelectedId] = useState("expired");
  const [loading, setLoading] = useState(true);
  const [summaryError, setSummaryError] = useState("");
  const [productsError, setProductsError] = useState("");

  const selectedFilter = alertFilters.find((filter) => filter.id === selectedId);

  useEffect(() => {
    const controller = new AbortController();
    setSummaryError("");
    apiFetch("/api/products/alerts", {
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await readJson(response);
        if (!response.ok) throw new Error(result.error || "Could not load alert summary.");
        setSummary(result.alerts);
      })
      .catch((error) => {
        if (error.name !== "AbortError") setSummaryError(error.message);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams(selectedFilter.params);
    setLoading(true);
    setProductsError("");
    apiFetch(`/api/products?${params}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await readJson(response);
        if (!response.ok) throw new Error(result.error || "Could not load alert products.");
        setProducts(result.products);
      })
      .catch((error) => {
        if (error.name !== "AbortError") setProductsError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [selectedFilter]);

  return (
    <div className="expiry-alerts">
      <div className="inventory-toolbar">
        <div>
          <h2>Stock &amp; Expiry Alerts</h2>
          <p className="inventory-subtitle">
            Live status calculated from product stock and expiry dates.
            {summary?.as_of_date ? ` As of ${displayDate(summary.as_of_date)}.` : ""}
          </p>
        </div>
      </div>

      {summaryError && <p className="inventory-error" role="alert">{summaryError}</p>}
      <div className="alert-summary" aria-label="Stock and expiry alert counts">
        {alertFilters.map((filter) => (
          <button
            className={`alert-summary-card${selectedId === filter.id ? " selected" : ""}`}
            key={filter.id}
            onClick={() => setSelectedId(filter.id)}
            aria-pressed={selectedId === filter.id}
          >
            <span>{filter.label}</span>
            <strong>{summary ? summary[filter.key] : "—"}</strong>
          </button>
        ))}
      </div>

      <section className="alert-products content-card" aria-labelledby="alert-products-title">
        <div className="sale-card-heading">
          <div>
            <h3 id="alert-products-title">{selectedFilter.label}</h3>
            <p className="inventory-subtitle">Select an alert above to inspect matching products.</p>
          </div>
          <span className="phase-chip">
            {summary ? `${products.length} shown` : "Loading"}
          </span>
        </div>
        {productsError && <p className="inventory-error" role="alert">{productsError}</p>}
        <div className="inventory-table-wrap">
          <table className="inventory-table alerts-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Current Stock</th>
                <th>Minimum Stock</th>
                <th>Stock Status</th>
                <th>Expiry Date</th>
                <th>Expiry Status</th>
                <th>Days to Expiry</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td className="table-message" colSpan="7">Loading alert products…</td></tr>
              ) : products.length === 0 ? (
                <tr><td className="table-message" colSpan="7">No products match this alert.</td></tr>
              ) : products.map((product, index) => (
                <tr key={product.product_id}>
                  <td>
                    <strong>{product.product_name}</strong>
                    {index === 0 && product.days_to_expiry >= 0 && product.days_to_expiry <= 30 && (
                      <small className="fefo-hint">Use this product first — expires sooner.</small>
                    )}
                  </td>
                  <td>{product.current_stock}</td>
                  <td>{product.minimum_stock}</td>
                  <td><span className={`stock-pill ${stockClass(product.stock_status)}`}>{product.stock_status}</span></td>
                  <td>{displayDate(product.expiry_date)}</td>
                  <td>
                    <span className={`stock-pill ${expiryClass(product.expiry_status)}`}>
                      {statusLabels[product.expiry_status] || "—"}
                    </span>
                  </td>
                  <td>{daysLabel(product.days_to_expiry)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <p className="inventory-subtitle alert-rule-note">
        Expiring today is classified as expired. The 7-day and 8–30-day alert buckets do not overlap.
        Alerts do not change stock or prevent sales.
      </p>
    </div>
  );
}
