import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "./api.js";

const reasonOptions = [
  ["UNRECORDED_SALE", "Unrecorded Sale"],
  ["DAMAGE", "Damaged Product"],
  ["RETURN", "Return"],
  ["COUNTING_ERROR", "Counting Error"],
  ["MISSING_STOCK", "Missing / Unaccounted Stock"],
  ["OTHER", "Other"],
];

const reasonLabels = Object.fromEntries(reasonOptions);
const statusLabels = {
  MATCHED: "Matched",
  UNACCOUNTED_STOCK: "Unaccounted Stock",
  OVERAGE: "Overage",
};

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function displayDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "—" : date.toLocaleString();
}

function dateOnly(value) {
  if (!value) return "—";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(date.valueOf())
    ? "—"
    : date.toLocaleDateString(undefined, { timeZone: "UTC" });
}

function statusClass(status) {
  if (status === "MATCHED") return "audit-matched";
  return status === "UNACCOUNTED_STOCK" ? "audit-unaccounted" : "audit-overage";
}

export default function StockAuditPage() {
  const [search, setSearch] = useState("");
  const [products, setProducts] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [physicalStock, setPhysicalStock] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [summary, setSummary] = useState(null);
  const [audits, setAudits] = useState([]);
  const [filters, setFilters] = useState({
    search: "",
    status: "",
    reason: "",
    dateFrom: "",
    dateTo: "",
  });
  const [selectedAudit, setSelectedAudit] = useState(null);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [loadingAudits, setLoadingAudits] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadSummary = useCallback(async (signal) => {
    const response = await apiFetch("/api/stock-audits/summary", {
      credentials: "same-origin",
      signal,
    });
    const result = await readJson(response);
    if (!response.ok) throw new Error(result.error || "Could not load audit summary.");
    setSummary(result.summary);
  }, []);

  const loadAudits = useCallback(async (signal) => {
    setLoadingAudits(true);
    const params = new URLSearchParams();
    for (const [field, value] of Object.entries(filters)) {
      if (value) params.set(field, value);
    }
    try {
      const response = await apiFetch(`/api/stock-audits?${params}`, {
        credentials: "same-origin",
        signal,
      });
      const result = await readJson(response);
      if (!response.ok) throw new Error(result.error || "Could not load audit history.");
      setAudits(result.audits);
    } catch (loadError) {
      if (loadError.name !== "AbortError") setError(loadError.message);
    } finally {
      if (!signal.aborted) setLoadingAudits(false);
    }
  }, [filters]);

  useEffect(() => {
    const controller = new AbortController();
    loadSummary(controller.signal).catch((loadError) => {
      if (loadError.name !== "AbortError") setError(loadError.message);
    });
    return () => controller.abort();
  }, [loadSummary]);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => void loadAudits(controller.signal), 150);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [loadAudits]);

  async function searchProducts(event) {
    event.preventDefault();
    const term = search.trim();
    if (!term) {
      setProducts([]);
      setError("Enter a product name or barcode.");
      return;
    }
    setLoadingProducts(true);
    setError("");
    setNotice("");
    try {
      const response = await apiFetch(`/api/products?search=${encodeURIComponent(term)}`, {
        credentials: "same-origin",
      });
      const result = await readJson(response);
      if (!response.ok) throw new Error(result.error || "Could not search inventory.");
      setProducts(result.products);
      if (!result.products.length) setNotice("No matching products found.");
    } catch (searchError) {
      setError(searchError.message);
    } finally {
      setLoadingProducts(false);
    }
  }

  async function chooseProduct(product) {
    setSelectedProduct({ ...product, location: null });
    setPhysicalStock("");
    setReason("");
    setNotes("");
    setError("");
    try {
      const response = await apiFetch(`/api/products/${product.product_id}/location`, {
        credentials: "same-origin",
      });
      const result = await readJson(response);
      if (!response.ok) throw new Error(result.error || "Could not load product location.");
      setSelectedProduct({
        ...result.product,
        location: result.location,
      });
    } catch (locationError) {
      setError(locationError.message);
    }
  }

  async function submitAudit(event) {
    event.preventDefault();
    if (!selectedProduct) return;
    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      const response = await apiFetch("/api/stock-audits", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_id: selectedProduct.product_id,
          physical_stock: physicalStock,
          reason: reason || null,
          notes: notes || null,
        }),
      });
      const result = await readJson(response);
      if (!response.ok) throw new Error(result.error || "Could not submit stock audit.");
      setNotice(`Audit recorded. ${statusLabels[result.audit.status]}. Inventory stock was not changed.`);
      setSelectedProduct(null);
      setPhysicalStock("");
      setReason("");
      setNotes("");
      const controller = new AbortController();
      await Promise.all([
        loadSummary(controller.signal),
        loadAudits(controller.signal),
      ]);
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function showDetails(auditId) {
    setError("");
    try {
      const response = await apiFetch(`/api/stock-audits/${auditId}`, {
        credentials: "same-origin",
      });
      const result = await readJson(response);
      if (!response.ok) throw new Error(result.error || "Could not load audit details.");
      setSelectedAudit(result.audit);
    } catch (detailsError) {
      setError(detailsError.message);
    }
  }

  const previewDifference = selectedProduct && /^\d+$/.test(physicalStock)
    ? Number(physicalStock) - selectedProduct.current_stock
    : null;

  return (
    <div className="stock-audit">
      <div className="inventory-toolbar">
        <div>
          <h2>Stock Audit</h2>
          <p className="inventory-subtitle">
            Compare a physical count with current expected inventory. Audits do not change stock.
          </p>
        </div>
      </div>

      {error && <p className="inventory-error" role="alert">{error}</p>}
      {notice && <p className="locator-notice" role="status">{notice}</p>}

      <div className="audit-summary" aria-label="Stock audit summary">
        {[
          ["Total Audits", "total_audits"],
          ["Matched", "matched"],
          ["Unaccounted Stock", "unaccounted"],
          ["Overage", "overage"],
          ["Unaccounted Quantity", "unaccounted_quantity"],
          ["Overage Quantity", "overage_quantity"],
        ].map(([label, key]) => (
          <div className="audit-summary-card" key={key}>
            <span>{label}</span><strong>{summary?.[key] ?? "—"}</strong>
          </div>
        ))}
      </div>

      <section className="content-card audit-create" aria-labelledby="audit-create-heading">
        <h3 id="audit-create-heading">Record a physical count</h3>
        <form className="audit-product-search" onSubmit={searchProducts}>
          <label className="search-field">
            <span>Search product</span>
            <input
              type="search"
              value={search}
              placeholder="Product name or barcode"
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <button className="primary-button" disabled={loadingProducts}>
            {loadingProducts ? "Searching…" : "Search"}
          </button>
        </form>
        {products.length > 0 && (
          <div className="audit-product-results" aria-label="Product search results">
            {products.map((product) => (
              <button
                className={`sale-search-result${selectedProduct?.product_id === product.product_id ? " selected" : ""}`}
                key={product.product_id}
                onClick={() => void chooseProduct(product)}
              >
                <span><strong>{product.product_name}</strong><small>{product.barcode || "No barcode"}</small></span>
                <span>Expected stock: {product.current_stock}</span>
              </button>
            ))}
          </div>
        )}

        {selectedProduct && (
          <form className="audit-entry-form" onSubmit={submitAudit}>
            <div className="audit-selected-product">
              <h4>{selectedProduct.product_name}</h4>
              <dl className="product-detail-list">
                <Detail label="Barcode" value={selectedProduct.barcode || "—"} />
                <Detail label="Category" value={selectedProduct.category || "—"} />
                <Detail label="Brand" value={selectedProduct.brand || "—"} />
                <Detail label="Current / expected stock" value={selectedProduct.current_stock} />
                <Detail label="Minimum stock" value={selectedProduct.minimum_stock} />
                <Detail label="Stock status" value={selectedProduct.stock_status} />
                <Detail label="Expiry" value={`${selectedProduct.expiry_date || "—"} · ${selectedProduct.expiry_status}`} />
                <Detail
                  label="Location"
                  value={selectedProduct.location
                    ? `Rack ${selectedProduct.location.rack_code} · Shelf ${selectedProduct.location.shelf_code}`
                    : "Location not assigned yet"}
                />
              </dl>
            </div>
            <div className="audit-form-fields">
              <label>
                Physical count
                <input
                  type="number"
                  min="0"
                  step="1"
                  required
                  value={physicalStock}
                  onChange={(event) => setPhysicalStock(event.target.value)}
                />
              </label>
              <label>
                Possible reason (optional; not a finding)
                <select value={reason} onChange={(event) => setReason(event.target.value)}>
                  <option value="">Select a reason</option>
                  {reasonOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="audit-notes-field">
                Notes (optional)
                <textarea
                  maxLength="1000"
                  rows="3"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Additional context about the count"
                />
              </label>
            </div>
            {previewDifference !== null && (
              <div className="audit-preview" aria-live="polite">
                <Detail label="Expected" value={selectedProduct.current_stock} />
                <Detail label="Physical" value={Number(physicalStock)} />
                <Detail label="Difference" value={signed(previewDifference)} />
                <Detail label="Status" value={previewStatus(previewDifference)} />
                <p>The server records expected stock at audit creation. Submitting does not adjust inventory.</p>
              </div>
            )}
            <button className="primary-button audit-submit" disabled={submitting}>
              {submitting ? "Recording audit…" : "Submit audit"}
            </button>
          </form>
        )}
      </section>

      <section className="audit-history" aria-labelledby="audit-history-heading">
        <div className="inventory-toolbar">
          <div>
            <h3 id="audit-history-heading">Audit history</h3>
            <p className="inventory-subtitle">Completed audits are immutable historical records.</p>
          </div>
        </div>
        <div className="inventory-filters audit-filters" aria-label="Filter stock audits">
          <label className="search-field">
            <span>Product or barcode</span>
            <input type="search" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} />
          </label>
          <label>
            <span>Status</span>
            <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
              <option value="">All statuses</option>
              <option value="MATCHED">Matched</option>
              <option value="UNACCOUNTED_STOCK">Unaccounted Stock</option>
              <option value="OVERAGE">Overage</option>
            </select>
          </label>
          <label>
            <span>Reason</span>
            <select value={filters.reason} onChange={(event) => setFilters({ ...filters, reason: event.target.value })}>
              <option value="">All reasons</option>
              {reasonOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>
            <span>From date</span>
            <input type="date" value={filters.dateFrom} onChange={(event) => setFilters({ ...filters, dateFrom: event.target.value })} />
          </label>
          <label>
            <span>To date</span>
            <input type="date" value={filters.dateTo} onChange={(event) => setFilters({ ...filters, dateTo: event.target.value })} />
          </label>
          <button className="text-button clear-filters" onClick={() => setFilters({ search: "", status: "", reason: "", dateFrom: "", dateTo: "" })}>
            Clear filters
          </button>
        </div>
        <div className="inventory-table-wrap">
          <table className="inventory-table audit-history-table">
            <thead>
              <tr>
                <th>Product</th><th>Barcode</th><th>Expected</th><th>Physical</th>
                <th>Difference</th><th>Status</th><th>Reason</th><th>Audited By</th><th>Date</th><th>Details</th>
              </tr>
            </thead>
            <tbody>
              {loadingAudits ? (
                <tr><td className="table-message" colSpan="10">Loading audit history…</td></tr>
              ) : audits.length === 0 ? (
                <tr><td className="table-message" colSpan="10">No audits match these filters.</td></tr>
              ) : audits.map((audit) => (
                <tr key={audit.audit_id}>
                  <td>{audit.product_name}</td>
                  <td>{audit.barcode || "—"}</td>
                  <td>{audit.expected_stock}</td>
                  <td>{audit.physical_stock}</td>
                  <td>{signed(audit.difference)}</td>
                  <td><span className={`stock-pill ${statusClass(audit.status)}`}>{statusLabels[audit.status]}</span></td>
                  <td>{reasonLabels[audit.reason] || "—"}</td>
                  <td>{audit.audited_by_name}</td>
                  <td>{displayDate(audit.audited_at)}</td>
                  <td><button className="text-button" onClick={() => void showDetails(audit.audit_id)}>View</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {selectedAudit && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setSelectedAudit(null);
        }}>
          <section className="product-modal details-modal" role="dialog" aria-modal="true" aria-labelledby="audit-detail-title">
            <div className="modal-heading">
              <div><p className="eyebrow">Immutable audit record</p><h2 id="audit-detail-title">{selectedAudit.product_name}</h2></div>
              <button className="icon-button" aria-label="Close" onClick={() => setSelectedAudit(null)}>×</button>
            </div>
            <dl className="product-detail-list">
              <Detail label="Audit ID" value={selectedAudit.audit_id} />
              <Detail label="Barcode" value={selectedAudit.barcode || "—"} />
              <Detail label="Category" value={selectedAudit.category || "—"} />
              <Detail label="Brand" value={selectedAudit.brand || "—"} />
              <Detail label="Expected stock" value={selectedAudit.expected_stock} />
              <Detail label="Physical stock" value={selectedAudit.physical_stock} />
              <Detail label="Difference" value={signed(selectedAudit.difference)} />
              <Detail label="Unaccounted quantity" value={selectedAudit.unaccounted_quantity} />
              <Detail label="Status" value={statusLabels[selectedAudit.status]} />
              <Detail label="Possible reason" value={reasonLabels[selectedAudit.reason] || "—"} />
              <Detail label="Notes" value={selectedAudit.notes || "—"} />
              <Detail label="Audited by" value={selectedAudit.audited_by_name} />
              <Detail label="Audited at" value={displayDate(selectedAudit.audited_at)} />
              <Detail label="Location" value={selectedAudit.rack_code
                ? `Rack ${selectedAudit.rack_code} · Shelf ${selectedAudit.shelf_code}`
                : "Location not assigned yet"} />
            </dl>
          </section>
        </div>
      )}
    </div>
  );
}

function previewStatus(difference) {
  if (difference === 0) return "Matched";
  return difference < 0 ? "Unaccounted Stock" : "Overage";
}

function signed(value) {
  return value > 0 ? `+${value}` : String(value);
}

function Detail({ label, value }) {
  return <div className="detail-row"><dt>{label}</dt><dd>{value}</dd></div>;
}
