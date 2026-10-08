import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "./api.js";

const methods = ["CASH", "UPI", "CARD"];
const methodLabels = { CASH: "Cash", UPI: "UPI", CARD: "Card" };
const statusLabels = {
  PAYMENT_MATCHED: "Payment Matched",
  SHORT_COLLECTION: "Short Collection",
  EXCESS_COLLECTION: "Excess Collection",
};

function today() {
  const date = new Date();
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

function formatMoney(value) {
  if (value === null || value === undefined || value === "") return "—";
  const match = String(value).match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return "—";
  const sign = match[1];
  const whole = BigInt(match[2]);
  const fraction = (match[3] || "").padEnd(2, "0");
  return `${sign}₹${whole.toLocaleString("en-IN")}.${fraction}`;
}

function displayPeriod(start, end) {
  if (!start || !end) return "—";
  const format = (value) => new Date(`${value}T00:00:00.000Z`)
    .toLocaleDateString(undefined, { timeZone: "UTC" });
  return start === end ? format(start) : `${format(start)} – ${format(end)}`;
}

function statusClass(status) {
  if (status === "PAYMENT_MATCHED") return "payment-matched";
  return status === "SHORT_COLLECTION" ? "payment-short" : "payment-excess";
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

export default function PaymentReconciliationPage() {
  const initialDate = today();
  const [period, setPeriod] = useState({ dateFrom: initialDate, dateTo: initialDate });
  const [appliedPeriod, setAppliedPeriod] = useState(period);
  const [summary, setSummary] = useState(null);
  const [actualAmounts, setActualAmounts] = useState({ CASH: "", UPI: "", CARD: "" });
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [staff, setStaff] = useState([]);
  const [staffFilters, setStaffFilters] = useState({ staffId: "", paymentMethod: "" });
  const [appliedStaffFilters, setAppliedStaffFilters] = useState(staffFilters);
  const [historyFilters, setHistoryFilters] = useState({
    dateFrom: "",
    dateTo: "",
    paymentMethod: "",
    status: "",
    reconciledBy: "",
  });
  const [appliedHistoryFilters, setAppliedHistoryFilters] = useState({});
  const [history, setHistory] = useState([]);
  const [reconcilers, setReconcilers] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadData = useCallback(async (signal) => {
    setLoading(true);
    setError("");
    const summaryParams = new URLSearchParams(appliedPeriod);
    const staffParams = new URLSearchParams({
      ...appliedPeriod,
      ...Object.fromEntries(
        Object.entries(appliedStaffFilters).filter(([, value]) => value),
      ),
    });
    const historyParams = new URLSearchParams(
      Object.fromEntries(
        Object.entries(appliedHistoryFilters).filter(([, value]) => value),
      ),
    );
    try {
      const [summaryResponse, staffResponse, historyResponse] = await Promise.all([
        apiFetch(`/api/payment-reconciliation/summary?${summaryParams}`, {
          credentials: "same-origin",
          signal,
        }),
        apiFetch(`/api/payment-reconciliation/staff-summary?${staffParams}`, {
          credentials: "same-origin",
          signal,
        }),
        apiFetch(`/api/payment-reconciliation/history?${historyParams}`, {
          credentials: "same-origin",
          signal,
        }),
      ]);
      const [summaryResult, staffResult, historyResult] = await Promise.all([
        readJson(summaryResponse),
        readJson(staffResponse),
        readJson(historyResponse),
      ]);
      if (!summaryResponse.ok) throw new Error(summaryResult.error || "Could not load payment summary.");
      if (!staffResponse.ok) throw new Error(staffResult.error || "Could not load staff sales summary.");
      if (!historyResponse.ok) throw new Error(historyResult.error || "Could not load reconciliation history.");
      setSummary(summaryResult.summary);
      setActualAmounts(Object.fromEntries(methods.map((method) => [
        method,
        summaryResult.summary.payment_methods.find((item) => item.payment_method === method)?.actual_amount ?? "",
      ])));
      setStaff(staffResult.staff);
      setHistory(historyResult.reconciliations);
      setReconcilers(historyResult.reconcilers);
    } catch (loadError) {
      if (loadError.name !== "AbortError") setError(loadError.message);
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [appliedPeriod, appliedStaffFilters, appliedHistoryFilters]);

  useEffect(() => {
    const controller = new AbortController();
    void loadData(controller.signal);
    return () => controller.abort();
  }, [loadData]);

  async function reconcile(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    setSubmitting(true);
    try {
      const response = await apiFetch("/api/payment-reconciliation", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          period_start: appliedPeriod.dateFrom,
          period_end: appliedPeriod.dateTo,
          actual_amounts: actualAmounts,
          reason: reason || null,
          notes: notes || null,
        }),
      });
      const result = await readJson(response);
      if (!response.ok) throw new Error(result.error || "Could not reconcile payments.");
      setNotice("Payment reconciliation recorded. Original sales and inventory were not changed.");
      const controller = new AbortController();
      await loadData(controller.signal);
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function showDetails(reconciliationId) {
    setError("");
    try {
      const response = await apiFetch(
        `/api/payment-reconciliation/${reconciliationId}`,
        { credentials: "same-origin" },
      );
      const result = await readJson(response);
      if (!response.ok) throw new Error(result.error || "Could not load reconciliation details.");
      setSelected(result.reconciliation);
    } catch (detailsError) {
      setError(detailsError.message);
    }
  }

  function applyPeriod(event) {
    event.preventDefault();
    setAppliedPeriod({ ...period });
    setNotice("");
    setError("");
  }

  function applyStaffFilters(event) {
    event.preventDefault();
    setAppliedStaffFilters({ ...staffFilters });
  }

  function applyHistoryFilters(event) {
    event.preventDefault();
    setAppliedHistoryFilters({ ...historyFilters });
  }

  const alreadyReconciled = summary?.actual_collection !== null &&
    summary?.actual_collection !== undefined;

  return (
    <div className="payment-reconciliation">
      <div className="inventory-toolbar">
        <div>
          <h2>Payment Reconciliation</h2>
          <p className="inventory-subtitle">
            Compare recorded sales with collected amounts. Differences require review and do not determine a cause.
          </p>
        </div>
      </div>

      {error && <p className="inventory-error" role="alert">{error}</p>}
      {notice && <p className="locator-notice" role="status">{notice}</p>}

      <section className="content-card payment-panel" aria-label="Select reconciliation period">
        <form className="payment-filter-form" onSubmit={applyPeriod}>
          <label>
            Start date
            <input
              type="date"
              required
              value={period.dateFrom}
              onChange={(event) => setPeriod({ ...period, dateFrom: event.target.value })}
            />
          </label>
          <label>
            End date
            <input
              type="date"
              required
              value={period.dateTo}
              onChange={(event) => setPeriod({ ...period, dateTo: event.target.value })}
            />
          </label>
          <button className="primary-button payment-apply" disabled={loading}>Apply period</button>
        </form>
      </section>

      <section className="payment-summary" aria-label="Payment reconciliation summary">
        {[
          ["Total Recorded Sales", summary?.total_recorded_sales],
          ["Expected Collection", summary?.expected_collection],
          ["Actual Collection", summary?.actual_collection],
          ["Difference", summary?.difference],
        ].map(([label, value]) => (
          <div className="payment-summary-card" key={label}>
            <span>{label}</span>
            <strong>{loading ? "…" : formatMoney(value)}</strong>
          </div>
        ))}
      </section>
      {summary?.status && (
        <p className={`payment-status ${statusClass(summary.status)}`} role="status">
          {statusLabels[summary.status]}
        </p>
      )}

      <section className="content-card payment-panel">
        <div className="payment-section-heading">
          <h3>Payment method breakdown</h3>
          <span>{displayPeriod(appliedPeriod.dateFrom, appliedPeriod.dateTo)}</span>
        </div>
        <form className="payment-entry-form" onSubmit={reconcile}>
          <div className="table-scroll">
            <table className="payment-table">
              <thead>
                <tr>
                  <th>Method</th>
                  <th>Expected</th>
                  <th>Actual collection</th>
                  <th>Difference</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {methods.map((method) => {
                  const row = summary?.payment_methods.find(
                    (item) => item.payment_method === method,
                  );
                  return (
                    <tr key={method}>
                      <td>{methodLabels[method]}</td>
                      <td>{formatMoney(row?.expected_amount)}</td>
                      <td>
                        <label className="payment-amount-field">
                          <span className="sr-only">{methodLabels[method]} actual collection</span>
                          <input
                            type="text"
                            inputMode="decimal"
                            required
                            pattern="[0-9]{1,20}([.][0-9]{1,2})?"
                            aria-label={`${methodLabels[method]} actual collection`}
                            disabled={loading || submitting || alreadyReconciled}
                            value={actualAmounts[method]}
                            onChange={(event) => setActualAmounts({
                              ...actualAmounts,
                              [method]: event.target.value,
                            })}
                            placeholder="0.00"
                          />
                        </label>
                      </td>
                      <td>{formatMoney(row?.difference)}</td>
                      <td>
                        {row?.status
                          ? <span className={`payment-status ${statusClass(row.status)}`}>
                              {statusLabels[row.status]}
                            </span>
                          : "Not reconciled"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="payment-extra-fields">
            <label>
              Reason (optional)
              <input
                type="text"
                maxLength="200"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
            <label>
              Notes (optional)
              <textarea
                maxLength="1000"
                rows="3"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </label>
          </div>
          <button
            className="primary-button payment-submit"
            disabled={loading || submitting || alreadyReconciled}
          >
            {submitting ? "Saving…" : alreadyReconciled ? "Period already reconciled" : "Reconcile payment"}
          </button>
        </form>
        <p className="payment-neutral-note">
          {alreadyReconciled
            ? "This period already has an immutable reconciliation. History preserves its saved figures; the summary reflects current recorded sales."
            : "Reconciliation records a comparison only. It never edits original sales, payment methods, or stock."}
        </p>
      </section>

      <section className="content-card payment-panel">
        <div className="payment-section-heading">
          <div>
            <h3>Staff-wise sales summary</h3>
            <p className="inventory-subtitle">Recorded sales by Staff account for the selected period.</p>
          </div>
        </div>
        <form className="payment-filter-form payment-staff-filters" onSubmit={applyStaffFilters}>
          <label>
            Staff
            <select
              value={staffFilters.staffId}
              onChange={(event) => setStaffFilters({
                ...staffFilters,
                staffId: event.target.value,
              })}
            >
              <option value="">All Staff</option>
              {staff.map((row) => (
                <option value={row.staff_id} key={row.staff_id}>{row.staff_name}</option>
              ))}
            </select>
          </label>
          <label>
            Payment method
            <select
              value={staffFilters.paymentMethod}
              onChange={(event) => setStaffFilters({
                ...staffFilters,
                paymentMethod: event.target.value,
              })}
            >
              <option value="">All methods</option>
              {methods.map((method) => (
                <option value={method} key={method}>{methodLabels[method]}</option>
              ))}
            </select>
          </label>
          <button className="secondary-button payment-apply">Apply staff filters</button>
        </form>
        <div className="table-scroll">
          <table className="payment-table">
            <thead>
              <tr><th>Staff</th><th>Sales Count</th><th>Total Sales</th><th>Expected Collection</th></tr>
            </thead>
            <tbody>
              {staff.length ? staff.map((row) => (
                <tr key={row.staff_id}>
                  <td>{row.staff_name}</td>
                  <td>{row.sales_count}</td>
                  <td>{formatMoney(row.total_sales)}</td>
                  <td>{formatMoney(row.expected_collection)}</td>
                </tr>
              )) : (
                <tr><td colSpan="4">{loading ? "Loading staff summary…" : "No Staff accounts found."}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="content-card payment-panel payment-history">
        <div className="payment-section-heading">
          <div>
            <h3>Reconciliation history</h3>
            <p className="inventory-subtitle">Saved comparisons are retained as historical records.</p>
          </div>
        </div>
        <form className="payment-filter-form payment-history-filters" onSubmit={applyHistoryFilters}>
          <label>
            From
            <input
              type="date"
              value={historyFilters.dateFrom}
              onChange={(event) => setHistoryFilters({
                ...historyFilters,
                dateFrom: event.target.value,
              })}
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={historyFilters.dateTo}
              onChange={(event) => setHistoryFilters({
                ...historyFilters,
                dateTo: event.target.value,
              })}
            />
          </label>
          <label>
            Method
            <select
              value={historyFilters.paymentMethod}
              onChange={(event) => setHistoryFilters({
                ...historyFilters,
                paymentMethod: event.target.value,
              })}
            >
              <option value="">All methods</option>
              {methods.map((method) => (
                <option value={method} key={method}>{methodLabels[method]}</option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select
              value={historyFilters.status}
              onChange={(event) => setHistoryFilters({
                ...historyFilters,
                status: event.target.value,
              })}
            >
              <option value="">All statuses</option>
              {Object.entries(statusLabels).map(([value, label]) => (
                <option value={value} key={value}>{label}</option>
              ))}
            </select>
          </label>
          <label>
            Reconciled by
            <select
              value={historyFilters.reconciledBy}
              onChange={(event) => setHistoryFilters({
                ...historyFilters,
                reconciledBy: event.target.value,
              })}
            >
              <option value="">All owners</option>
              {reconcilers.map((row) => (
                <option value={row.id} key={row.id}>{row.name}</option>
              ))}
            </select>
          </label>
          <button className="secondary-button payment-apply">Apply history filters</button>
        </form>
        <div className="table-scroll">
          <table className="payment-table payment-history-table">
            <thead>
              <tr>
                <th>Period</th><th>Method</th><th>Expected</th><th>Actual</th>
                <th>Difference</th><th>Status</th><th>Reconciled By</th><th>Reconciled At</th><th>Details</th>
              </tr>
            </thead>
            <tbody>
              {history.length ? history.map((row) => (
                <tr key={row.reconciliation_id}>
                  <td>{displayPeriod(row.period_start, row.period_end)}</td>
                  <td>{methodLabels[row.payment_method]}</td>
                  <td>{formatMoney(row.expected_amount)}</td>
                  <td>{formatMoney(row.actual_amount)}</td>
                  <td>{formatMoney(row.difference)}</td>
                  <td><span className={`payment-status ${statusClass(row.status)}`}>
                    {statusLabels[row.status]}
                  </span></td>
                  <td>{row.reconciled_by_name}</td>
                  <td>{new Date(row.reconciled_at).toLocaleString()}</td>
                  <td><button className="table-action" onClick={() => void showDetails(row.reconciliation_id)}>View</button></td>
                </tr>
              )) : (
                <tr><td colSpan="9">{loading ? "Loading reconciliation history…" : "No reconciliations match these filters."}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {selected && (
        <div className="dialog-backdrop" role="presentation" onClick={() => setSelected(null)}>
          <section
            className="content-card payment-detail-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="payment-detail-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="payment-section-heading">
              <div>
                <p className="eyebrow">Historical reconciliation record</p>
                <h3 id="payment-detail-title">{methodLabels[selected.payment_method]}</h3>
              </div>
              <button className="secondary-button" onClick={() => setSelected(null)}>Close</button>
            </div>
            <dl className="payment-detail-grid">
              <dt>Period</dt><dd>{displayPeriod(selected.period_start, selected.period_end)}</dd>
              <dt>Expected</dt><dd>{formatMoney(selected.expected_amount)}</dd>
              <dt>Actual</dt><dd>{formatMoney(selected.actual_amount)}</dd>
              <dt>Difference</dt><dd>{formatMoney(selected.difference)}</dd>
              <dt>Status</dt><dd>{statusLabels[selected.status]}</dd>
              <dt>Reason</dt><dd>{selected.reason || "—"}</dd>
              <dt>Notes</dt><dd>{selected.notes || "—"}</dd>
              <dt>Reconciled by</dt><dd>{selected.reconciled_by_name}</dd>
              <dt>Reconciled at</dt><dd>{new Date(selected.reconciled_at).toLocaleString()}</dd>
            </dl>
          </section>
        </div>
      )}
    </div>
  );
}
