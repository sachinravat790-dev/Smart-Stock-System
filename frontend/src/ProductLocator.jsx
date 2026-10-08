import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "./api.js";

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "—" : date.toLocaleString();
}

export default function ProductLocatorPage() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [rack, setRack] = useState("");
  const [shelf, setShelf] = useState("");
  const [selected, setSelected] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [editor, setEditor] = useState(null);
  const [history, setHistory] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadProducts = useCallback(async (signal) => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (rack.trim()) params.set("rack", rack.trim());
    if (shelf.trim()) params.set("shelf", shelf.trim());
    try {
      const response = await apiFetch(`/api/product-locations?${params}`, {
        credentials: "same-origin",
        signal,
      });
      const result = await readJson(response);
      if (!response.ok) throw new Error(result.error || "Could not load products.");
      setProducts(result.products);
    } catch (loadError) {
      if (loadError.name !== "AbortError") setError(loadError.message);
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [rack, search, shelf]);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      void loadProducts(controller.signal);
    }, 180);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [loadProducts]);

  async function openProduct(product) {
    setDetailsLoading(true);
    setError("");
    setSelected({ product, location: null });
    try {
      const response = await apiFetch(
        `/api/products/${product.product_id}/location`,
        { credentials: "same-origin" },
      );
      const result = await readJson(response);
      if (!response.ok) throw new Error(result.error || "Could not load product location.");
      setSelected({ product: result.product, location: result.location });
    } catch (detailsError) {
      setError(detailsError.message);
      setSelected(null);
    } finally {
      setDetailsLoading(false);
    }
  }

  function editLocation(product) {
    setError("");
    setNotice("");
    setEditor({
      product,
      rack_code: product.rack_code || "",
      shelf_code: product.shelf_code || "",
      location_photo: product.location_photo || "",
    });
  }

  async function saveLocation(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await apiFetch(
        `/api/products/${editor.product.product_id}/location`,
        {
          method: "PUT",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rack_code: editor.rack_code,
            shelf_code: editor.shelf_code,
            location_photo: editor.location_photo,
          }),
        },
      );
      const result = await readJson(response);
      if (!response.ok) throw new Error(result.error || "Could not save location.");

      const updatedProduct = {
        ...editor.product,
        location_id: result.location.location_id,
        rack_code: result.location.rack_code,
        shelf_code: result.location.shelf_code,
        location_photo: result.location.location_photo,
        location_updated_at: result.location.updated_at,
      };
      setEditor(null);
      setNotice(
        result.changed
          ? `Location saved for ${updatedProduct.product_name}.`
          : `Location details updated for ${updatedProduct.product_name}.`,
      );
      setProducts((current) => current.map((item) =>
        item.product_id === updatedProduct.product_id
          ? updatedProduct
          : item,
      ));
      setSelected((current) =>
        current?.product.product_id === updatedProduct.product_id
          ? { product: updatedProduct, location: result.location }
          : current,
      );
      await loadProducts(new AbortController().signal);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  async function openHistory(product) {
    setHistoryLoading(true);
    setError("");
    setHistory({ product, entries: [] });
    try {
      const response = await apiFetch(
        `/api/products/${product.product_id}/location/history`,
        { credentials: "same-origin" },
      );
      const result = await readJson(response);
      if (!response.ok) throw new Error(result.error || "Could not load location history.");
      setHistory({ product, entries: result.history });
    } catch (historyError) {
      setError(historyError.message);
      setHistory(null);
    } finally {
      setHistoryLoading(false);
    }
  }

  function clearFilters() {
    setSearch("");
    setRack("");
    setShelf("");
  }

  return (
    <div className="product-locator">
      <div className="inventory-toolbar">
        <div>
          <h2>Find Product</h2>
          <p className="inventory-subtitle">
            Search products and see where they are stored.
          </p>
        </div>
      </div>

      <div className="inventory-filters locator-filters" aria-label="Search products and locations">
        <label className="search-field">
          <span>Search products</span>
          <input
            type="search"
            value={search}
            placeholder="Name, barcode, category, or brand"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label>
          <span>Rack</span>
          <input
            value={rack}
            maxLength="80"
            placeholder="Any rack"
            onChange={(event) => setRack(event.target.value)}
          />
        </label>
        <label>
          <span>Shelf</span>
          <input
            value={shelf}
            maxLength="80"
            placeholder="Any shelf"
            onChange={(event) => setShelf(event.target.value)}
          />
        </label>
        <button className="text-button clear-filters" onClick={clearFilters}>
          Clear filters
        </button>
      </div>

      {error && <p className="inventory-error" role="alert">{error}</p>}
      {notice && <p className="locator-notice" role="status">{notice}</p>}

      <div className="inventory-table-wrap">
        <table className="inventory-table locator-table">
          <thead>
            <tr>
              <th>Product</th>
              <th>Barcode</th>
              <th>Category</th>
              <th>Current Stock</th>
              <th>Rack</th>
              <th>Shelf</th>
              <th>Location Status</th>
              <th>Updated At</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="table-message" colSpan="9">Loading products…</td></tr>
            ) : products.length === 0 ? (
              <tr>
                <td className="table-message" colSpan="9">
                  {search || rack || shelf
                    ? "No products match these filters."
                    : "No products are available yet."}
                </td>
              </tr>
            ) : products.map((product) => (
              <tr key={product.product_id}>
                <td>
                  <button className="product-name-link" onClick={() => void openProduct(product)}>
                    {product.product_name}
                  </button>
                </td>
                <td>{product.barcode || "—"}</td>
                <td>{product.category || "—"}</td>
                <td>{product.current_stock}</td>
                <td>{product.rack_code || "—"}</td>
                <td>{product.shelf_code || "—"}</td>
                <td>
                  <span className={`location-status${product.location_id ? " assigned" : ""}`}>
                    {product.location_id ? "Assigned" : "Not Assigned"}
                  </span>
                </td>
                <td>{formatDate(product.location_updated_at)}</td>
                <td>
                  <div className="locator-actions">
                    <button className="text-button" onClick={() => editLocation(product)}>
                      {product.location_id ? "Edit / Move" : "Assign"}
                    </button>
                    <button className="text-button" onClick={() => void openHistory(product)}>
                      History
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="inventory-count">{products.length} products</p>

      {editor && (
        <div className="modal-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !saving) setEditor(null);
        }}>
          <section className="product-modal locator-modal" role="dialog" aria-modal="true" aria-labelledby="location-form-title">
            <div className="modal-heading">
              <div>
                <h2 id="location-form-title">
                  {editor.product.location_id ? "Edit product location" : "Assign product location"}
                </h2>
                <p className="inventory-subtitle">{editor.product.product_name}</p>
              </div>
              <button className="icon-button" aria-label="Close" onClick={() => setEditor(null)}>×</button>
            </div>
            <form className="product-form" onSubmit={saveLocation}>
              <label>
                Product
                <input value={editor.product.product_name} readOnly />
              </label>
              <label>
                Barcode
                <input value={editor.product.barcode || "—"} readOnly />
              </label>
              <label>
                Rack code <span className="required-mark">*</span>
                <input
                  value={editor.rack_code}
                  maxLength="80"
                  required
                  onChange={(event) => setEditor((current) => ({ ...current, rack_code: event.target.value }))}
                />
              </label>
              <label>
                Shelf code <span className="required-mark">*</span>
                <input
                  value={editor.shelf_code}
                  maxLength="80"
                  required
                  onChange={(event) => setEditor((current) => ({ ...current, shelf_code: event.target.value }))}
                />
              </label>
              <label className="field-span-two">
                Location photo URL (optional)
                <input
                  type="url"
                  maxLength="2048"
                  placeholder="https://…"
                  value={editor.location_photo}
                  onChange={(event) => setEditor((current) => ({ ...current, location_photo: event.target.value }))}
                />
              </label>
              {error && <p className="form-error field-span-two" role="alert">{error}</p>}
              <div className="form-actions">
                <button className="secondary-button" type="button" disabled={saving} onClick={() => setEditor(null)}>
                  Cancel
                </button>
                <button className="primary-button" disabled={saving}>
                  {saving ? "Saving…" : "Save location"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {selected && (
        <div className="modal-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setSelected(null);
        }}>
          <section className="product-modal details-modal locator-modal" role="dialog" aria-modal="true" aria-labelledby="product-details-title">
            <div className="modal-heading">
              <h2 id="product-details-title">{selected.product.product_name}</h2>
              <button className="icon-button" aria-label="Close" onClick={() => setSelected(null)}>×</button>
            </div>
            {detailsLoading ? (
              <p className="muted">Loading product location…</p>
            ) : (
              <>
                {selected.location?.location_photo && (
                  <img
                    className="location-photo"
                    src={selected.location.location_photo}
                    alt={`Location for ${selected.product.product_name}`}
                    referrerPolicy="no-referrer"
                    loading="lazy"
                  />
                )}
                <dl className="product-detail-list">
                  {[
                    ["Product Name", selected.product.product_name],
                    ["Barcode", selected.product.barcode || "—"],
                    ["Category", selected.product.category || "—"],
                    ["Brand", selected.product.brand || "—"],
                    ["Current Stock", selected.product.current_stock],
                    ["Rack", selected.location?.rack_code || "—"],
                    ["Shelf", selected.location?.shelf_code || "—"],
                  ].map(([label, value]) => (
                    <div className="detail-row" key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
                {!selected.location && (
                  <p className="locator-unassigned" role="status">Location not assigned yet.</p>
                )}
                <div className="locator-detail-actions">
                  <button className="secondary-button" onClick={() => {
                    const product = products.find((item) => item.product_id === selected.product.product_id);
                    if (product) editLocation(product);
                    setSelected(null);
                  }}>
                    {selected.location ? "Edit / Move Location" : "Assign Location"}
                  </button>
                  <button className="secondary-button" onClick={() => {
                    const product = products.find((item) => item.product_id === selected.product.product_id);
                    if (product) void openHistory(product);
                    setSelected(null);
                  }}>
                    View Location History
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}

      {history && (
        <div className="modal-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setHistory(null);
        }}>
          <section className="product-modal details-modal locator-modal" role="dialog" aria-modal="true" aria-labelledby="location-history-title">
            <div className="modal-heading">
              <div>
                <h2 id="location-history-title">Location history</h2>
                <p className="inventory-subtitle">{history.product.product_name}</p>
              </div>
              <button className="icon-button" aria-label="Close" onClick={() => setHistory(null)}>×</button>
            </div>
            {historyLoading ? (
              <p className="muted">Loading location history…</p>
            ) : history.entries.length === 0 ? (
              <p className="muted">No location changes have been recorded.</p>
            ) : (
              <ol className="location-history-list">
                {history.entries.map((entry) => (
                  <li key={entry.history_id}>
                    <strong>
                      {entry.previous_rack_code
                        ? `${entry.previous_rack_code}/${entry.previous_shelf_code}`
                        : "Not assigned"}
                      {" → "}
                      {entry.new_rack_code}/{entry.new_shelf_code}
                    </strong>
                    <span>Changed by {entry.changed_by} · {formatDate(entry.changed_at)}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
