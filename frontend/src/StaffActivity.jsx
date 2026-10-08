import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "./api.js";

const actionLabels = {
  LOGIN: "Login",
  LOGOUT: "Logout",
  RECEIVE_STOCK: "Receive Stock",
  ADD_PRODUCT: "Add Product",
  UPDATE_PRODUCT: "Update Product",
  MOVE_PRODUCT: "Move Product",
  SALE: "Sale",
  STOCK_AUDIT: "Stock Audit",
  PAYMENT_RECONCILIATION: "Payment Reconciliation",
};

const actionTypes = Object.keys(actionLabels);

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "—" : date.toLocaleString();
}

function displayQuantity(activity) {
  if (activity.quantity === null || activity.quantity === undefined) return "—";
  const quantity = Number(activity.quantity);
  return activity.action_type === "RECEIVE_STOCK" && quantity > 0
    ? `+${quantity}`
    : String(quantity);
}

function readableLabel(value) {
  return value
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function StaffActivityPage() {
  const [users, setUsers] = useState([]);
  const [activities, setActivities] = useState([]);
  const [summary, setSummary] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 25, total: 0, totalPages: 0 });
  const [filters, setFilters] = useState({
    userId: "",
    actionType: "",
    productSearch: "",
    dateFrom: "",
    dateTo: "",
    referenceType: "",
    referenceId: "",
  });
  const [appliedFilters, setAppliedFilters] = useState({});
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadData = useCallback(async (signal) => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      page: String(pagination.page),
      limit: String(pagination.limit),
      ...Object.fromEntries(
        Object.entries(appliedFilters).filter(([, value]) => value),
      ),
    });
    const summaryParams = new URLSearchParams();
    if (appliedFilters.dateFrom) summaryParams.set("dateFrom", appliedFilters.dateFrom);
    if (appliedFilters.dateTo) summaryParams.set("dateTo", appliedFilters.dateTo);
    try {
      const [activityResponse, summaryResponse] = await Promise.all([
        apiFetch(`/api/staff-activities?${params}`, {
          credentials: "same-origin",
          signal,
        }),
        apiFetch(`/api/staff-activities/summary?${summaryParams}`, {
          credentials: "same-origin",
          signal,
        }),
      ]);
      const [activityResult, summaryResult] = await Promise.all([
        readJson(activityResponse),
        readJson(summaryResponse),
      ]);
      if (!activityResponse.ok) {
        throw new Error(activityResult.error || "Could not load activity history.");
      }
      if (!summaryResponse.ok) {
        throw new Error(summaryResult.error || "Could not load staff activity summary.");
      }
      setUsers(activityResult.users);
      setActivities(activityResult.activities);
      setPagination(activityResult.pagination);
      setSummary(summaryResult.summary);
    } catch (loadError) {
      if (loadError.name !== "AbortError") setError(loadError.message);
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [appliedFilters, pagination.limit, pagination.page]);

  useEffect(() => {
    const controller = new AbortController();
    void loadData(controller.signal);
    return () => controller.abort();
  }, [loadData]);

  function applyFilters(event) {
    event.preventDefault();
    setAppliedFilters({ ...filters });
    setPagination((current) => ({ ...current, page: 1 }));
  }

  async function showDetails(activityId) {
    setError("");
    try {
      const response = await apiFetch(`/api/staff-activities/${activityId}`, {
        credentials: "same-origin",
      });
      const result = await readJson(response);
      if (!response.ok) throw new Error(result.error || "Could not load activity details.");
      setSelected(result.activity);
    } catch (detailsError) {
      setError(detailsError.message);
    }
  }

  return (
    <div className="staff-activity">
      <div className="inventory-toolbar">
        <div>
          <h2>Staff Activity</h2>
          <p className="inventory-subtitle">
            A chronological, read-only record of successful actions. Activity counts are not performance scores.
          </p>
        </div>
      </div>
      {error && <p className="inventory-error" role="alert">{error}</p>}

      <section className="content-card activity-summary-section">
        <div className="activity-section-heading">
          <div>
            <h3>Staff activity summary</h3>
            <p className="inventory-subtitle">Counts for the selected activity date range.</p>
          </div>
        </div>
        <div className="table-scroll">
          <table className="activity-table activity-summary-table">
            <thead>
              <tr>
                <th>Staff</th><th>Total Activities</th><th>Sales</th>
                <th>Receiving</th><th>Location Moves</th><th>Audits</th>
              </tr>
            </thead>
            <tbody>
              {summary.length ? summary.map((row) => (
                <tr key={row.user_id}>
                  <td>{row.user_name}</td>
                  <td>{row.total_activities}</td>
                  <td>{row.sales}</td>
                  <td>{row.receiving}</td>
                  <td>{row.location_moves}</td>
                  <td>{row.audits}</td>
                </tr>
              )) : (
                <tr><td colSpan="6">{loading ? "Loading staff summary…" : "No Staff accounts found."}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="content-card activity-history-section">
        <div className="activity-section-heading">
          <div>
            <h3>Activity history</h3>
            <p className="inventory-subtitle">Newest actions appear first. History is immutable.</p>
          </div>
        </div>
        <form className="inventory-filters activity-filters" onSubmit={applyFilters}>
          <label>
            Staff / user
            <select
              value={filters.userId}
              onChange={(event) => setFilters({ ...filters, userId: event.target.value })}
            >
              <option value="">All users</option>
              {users.map((user) => (
                <option value={user.id} key={user.id}>{user.name} ({readableLabel(user.role)})</option>
              ))}
            </select>
          </label>
          <label>
            Action
            <select
              value={filters.actionType}
              onChange={(event) => setFilters({ ...filters, actionType: event.target.value })}
            >
              <option value="">All actions</option>
              {actionTypes.map((action) => (
                <option value={action} key={action}>{actionLabels[action]}</option>
              ))}
            </select>
          </label>
          <label className="activity-product-filter">
            Product / barcode
            <input
              type="search"
              maxLength="160"
              value={filters.productSearch}
              onChange={(event) => setFilters({ ...filters, productSearch: event.target.value })}
            />
          </label>
          <label>
            From
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(event) => setFilters({ ...filters, dateFrom: event.target.value })}
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={filters.dateTo}
              onChange={(event) => setFilters({ ...filters, dateTo: event.target.value })}
            />
          </label>
          <label>
            Reference type
            <input
              type="text"
              maxLength="80"
              value={filters.referenceType}
              onChange={(event) => setFilters({ ...filters, referenceType: event.target.value })}
            />
          </label>
          <label>
            Reference ID
            <input
              type="text"
              maxLength="160"
              value={filters.referenceId}
              onChange={(event) => setFilters({ ...filters, referenceId: event.target.value })}
            />
          </label>
          <button className="primary-button activity-filter-button">Apply filters</button>
        </form>
        <div className="table-scroll">
          <table className="activity-table activity-history-table">
            <thead>
              <tr>
                <th>Time</th><th>User</th><th>Action</th><th>Product</th>
                <th>Barcode</th><th>Quantity</th><th>Reference</th><th>Details</th>
              </tr>
            </thead>
            <tbody>
              {activities.length ? activities.map((activity) => (
                <tr key={activity.activity_id}>
                  <td>{formatDate(activity.created_at)}</td>
                  <td>{activity.user_name} <span className="activity-role">{readableLabel(activity.user_role)}</span></td>
                  <td>{actionLabels[activity.action_type]}</td>
                  <td>{activity.product_name || "—"}</td>
                  <td>{activity.barcode || "—"}</td>
                  <td>{displayQuantity(activity)}</td>
                  <td>{activity.reference_type ? `${readableLabel(activity.reference_type)} · ${activity.reference_id}` : "—"}</td>
                  <td><button className="table-action" onClick={() => void showDetails(activity.activity_id)}>View</button></td>
                </tr>
              )) : (
                <tr><td colSpan="8">{loading ? "Loading activity…" : "No activities match these filters."}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="activity-pagination" aria-label="Activity history pagination">
          <span>
            {pagination.total
              ? `Showing ${(pagination.page - 1) * pagination.limit + 1}–${Math.min(pagination.page * pagination.limit, pagination.total)} of ${pagination.total}`
              : "No activity records"}
          </span>
          <div>
            <button
              className="secondary-button"
              disabled={loading || pagination.page <= 1}
              onClick={() => setPagination((current) => ({ ...current, page: current.page - 1 }))}
            >Previous</button>
            <span>Page {pagination.page} of {pagination.totalPages}</span>
            <button
              className="secondary-button"
              disabled={loading || pagination.page >= pagination.totalPages}
              onClick={() => setPagination((current) => ({ ...current, page: current.page + 1 }))}
            >Next</button>
          </div>
        </div>
      </section>

      {selected && (
        <div className="dialog-backdrop" role="presentation" onClick={() => setSelected(null)}>
          <section
            className="content-card activity-detail-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="activity-detail-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="activity-section-heading">
              <div>
                <p className="eyebrow">Immutable activity record</p>
                <h3 id="activity-detail-title">{actionLabels[selected.action_type]}</h3>
              </div>
              <button className="secondary-button" onClick={() => setSelected(null)}>Close</button>
            </div>
            <dl className="activity-detail-grid">
              <dt>Activity ID</dt><dd>{selected.activity_id}</dd>
              <dt>User</dt><dd>{selected.user_name} ({readableLabel(selected.user_role)})</dd>
              <dt>Action</dt><dd>{actionLabels[selected.action_type]}</dd>
              <dt>Product</dt><dd>{selected.product_name || "—"}</dd>
              <dt>Barcode</dt><dd>{selected.barcode || "—"}</dd>
              <dt>Quantity</dt><dd>{displayQuantity(selected)}</dd>
              <dt>Date and time</dt><dd>{formatDate(selected.created_at)}</dd>
              <dt>Reference type</dt><dd>{selected.reference_type || "—"}</dd>
              <dt>Reference ID</dt><dd>{selected.reference_id || "—"}</dd>
              <dt>Context</dt><dd><pre>{JSON.stringify(selected.metadata, null, 2)}</pre></dd>
            </dl>
          </section>
        </div>
      )}
    </div>
  );
}
