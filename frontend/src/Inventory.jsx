import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "./api.js";

const emptyProduct = {
  product_name: "",
  barcode: "",
  category: "",
  brand: "",
  purchase_price: "0",
  selling_price: "0",
  current_stock: "0",
  minimum_stock: "0",
  expiry_date: "",
  product_image: "",
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
  return new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`).toLocaleDateString(
    undefined,
    { timeZone: "UTC" },
  );
}

function currency(value) {
  return Number(value).toFixed(2);
}

function statusClass(status) {
  if (status === "In Stock") return "stock-in";
  if (status === "Low Stock") return "stock-low";
  return "stock-out";
}

function expiryStatusLabel(status) {
  return {
    EXPIRED: "Expired",
    EXPIRING_SOON_7_DAYS: "Expiring in 7 days",
    EXPIRING_30_DAYS: "Expiring in 8–30 days",
    SAFE: "Safe",
    NO_EXPIRY_DATE: "No expiry date",
  }[status] || "—";
}

function expiryStatusClass(status) {
  return {
    EXPIRED: "expiry-expired",
    EXPIRING_SOON_7_DAYS: "expiry-soon",
    EXPIRING_30_DAYS: "expiry-upcoming",
    SAFE: "expiry-safe",
  }[status] || "expiry-none";
}

export default function InventoryPage() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [stockStatus, setStockStatus] = useState("");
  const [expiryStatus, setExpiryStatus] = useState("");
  const [expiryFrom, setExpiryFrom] = useState("");
  const [expiryTo, setExpiryTo] = useState("");
  const [editor, setEditor] = useState(null);
  const [details, setDetails] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const categories = useMemo(
    () => [...new Set(products.map((product) => product.category).filter(Boolean))].sort(),
    [products],
  );

  const loadProducts = useCallback(async (signal) => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (category) params.set("category", category);
    if (stockStatus) params.set("stockStatus", stockStatus);
    if (expiryStatus) params.set("expiryStatus", expiryStatus);
    if (expiryFrom) params.set("expiryFrom", expiryFrom);
    if (expiryTo) params.set("expiryTo", expiryTo);
    try {
      const response = await apiFetch(`/api/products?${params}`, {
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
  }, [category, expiryFrom, expiryStatus, expiryTo, search, stockStatus]);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      void loadProducts(controller.signal);
    }, 200);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [loadProducts]);

  async function openDetails(productId) {
    setError("");
    try {
      const response = await apiFetch(`/api/products/${productId}`, {
        credentials: "same-origin",
      });
      const result = await readJson(response);
      if (!response.ok) throw new Error(result.error || "Could not load product details.");
      setDetails(result.product);
    } catch (detailsError) {
      setError(detailsError.message);
    }
  }

  async function saveProduct(product) {
    const editing = Boolean(product.product_id);
    const response = await apiFetch(
      editing ? `/api/products/${product.product_id}` : "/api/products",
      {
        method: editing ? "PUT" : "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(product),
      },
    );
    const result = await readJson(response);
    if (!response.ok) throw new Error(result.error || "Could not save product.");
    setEditor(null);
    if (details?.product_id === result.product.product_id) setDetails(result.product);
    await loadProducts(new AbortController().signal);
    return result.product;
  }

  async function deleteProduct() {
    if (!details) return;
    setDeleting(true);
    setError("");
    try {
      const response = await apiFetch(`/api/products/${details.product_id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const result = await readJson(response);
      if (!response.ok) throw new Error(result.error || "Could not delete product.");
      setDetails(null);
      await loadProducts(new AbortController().signal);
    } catch (deleteError) {
      setError(deleteError.message);
    } finally {
      setDeleting(false);
    }
  }

  function clearFilters() {
    setSearch("");
    setCategory("");
    setStockStatus("");
    setExpiryStatus("");
    setExpiryFrom("");
    setExpiryTo("");
  }

  return (
    <div className="inventory">
      <div className="inventory-toolbar">
        <div>
          <h2>Products</h2>
          <p className="inventory-subtitle">Manage product details and current stock.</p>
        </div>
        <button className="primary-button add-product-button" onClick={() => setEditor({ ...emptyProduct })}>
          <span aria-hidden="true">+</span> Add product
        </button>
      </div>

      <div className="inventory-filters" aria-label="Search and filter products">
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
          <span>Category</span>
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="">All categories</option>
            {categories.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label>
          <span>Stock status</span>
          <select value={stockStatus} onChange={(event) => setStockStatus(event.target.value)}>
            <option value="">All statuses</option>
            <option value="in-stock">In Stock</option>
            <option value="low-stock">Low Stock</option>
            <option value="out-of-stock">Out of Stock</option>
          </select>
        </label>
        <label>
          <span>Expiry status</span>
          <select value={expiryStatus} onChange={(event) => setExpiryStatus(event.target.value)}>
            <option value="">All expiry statuses</option>
            <option value="expired">Expired</option>
            <option value="expiring-7-days">Expiring in 7 days</option>
            <option value="expiring-30-days">Expiring in 8–30 days</option>
            <option value="safe">Safe</option>
            <option value="no-expiry-date">No expiry date</option>
          </select>
        </label>
        <label>
          <span>Expiry from</span>
          <input type="date" value={expiryFrom} onChange={(event) => setExpiryFrom(event.target.value)} />
        </label>
        <label>
          <span>Expiry to</span>
          <input type="date" value={expiryTo} onChange={(event) => setExpiryTo(event.target.value)} />
        </label>
        <button className="text-button clear-filters" onClick={clearFilters}>Clear filters</button>
      </div>

      {error && <p className="inventory-error" role="alert">{error}</p>}
      <div className="inventory-table-wrap">
        <table className="inventory-table">
          <thead>
            <tr>
              <th>Product Name</th>
              <th>Barcode</th>
              <th>Category</th>
              <th>Current Stock</th>
              <th>Minimum Stock</th>
              <th>Selling Price</th>
              <th>Expiry Date</th>
              <th>Expiry Status</th>
              <th>Stock Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="table-message" colSpan="9">Loading products…</td></tr>
            ) : products.length === 0 ? (
              <tr>
                <td className="table-message" colSpan="9">
                  {search || category || stockStatus || expiryStatus || expiryFrom || expiryTo
                    ? "No products match these filters."
                    : "No products yet. Add your first product to get started."}
                </td>
              </tr>
            ) : products.map((product) => (
              <tr key={product.product_id}>
                <td>
                  <button className="product-name-link" onClick={() => void openDetails(product.product_id)}>
                    {product.product_name}
                  </button>
                </td>
                <td>{product.barcode || "—"}</td>
                <td>{product.category || "—"}</td>
                <td>{product.current_stock}</td>
                <td>{product.minimum_stock}</td>
                <td>{currency(product.selling_price)}</td>
                <td>{displayDate(product.expiry_date)}</td>
                <td>
                  <span className={`stock-pill ${expiryStatusClass(product.expiry_status)}`}>
                    {expiryStatusLabel(product.expiry_status)}
                  </span>
                </td>
                <td><span className={`stock-pill ${statusClass(product.stock_status)}`}>{product.stock_status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="inventory-count">{products.length} {products.length === 1 ? "product" : "products"}</p>

      {editor && (
        <ProductEditor
          initialProduct={editor}
          onClose={() => setEditor(null)}
          onSave={saveProduct}
        />
      )}
      {details && (
        <ProductDetails
          product={details}
          deleting={deleting}
          onClose={() => setDetails(null)}
          onEdit={() => {
            setEditor({ ...details });
            setDetails(null);
          }}
          onDelete={() => void deleteProduct()}
        />
      )}
    </div>
  );
}

function ProductEditor({ initialProduct, onClose, onSave }) {
  const [form, setForm] = useState(() => ({
    ...emptyProduct,
    ...initialProduct,
    purchase_price: String(initialProduct.purchase_price ?? 0),
    selling_price: String(initialProduct.selling_price ?? 0),
    current_stock: String(initialProduct.current_stock ?? 0),
    minimum_stock: String(initialProduct.minimum_stock ?? 0),
    expiry_date: initialProduct.expiry_date ? String(initialProduct.expiry_date).slice(0, 10) : "",
  }));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const editing = Boolean(initialProduct.product_id);

  function change(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      await onSave({
        ...form,
        purchase_price: Number(form.purchase_price),
        selling_price: Number(form.selling_price),
        current_stock: Number(form.current_stock),
        minimum_stock: Number(form.minimum_stock),
      });
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="product-modal" role="dialog" aria-modal="true" aria-labelledby="product-form-title">
        <div className="modal-heading">
          <div>
            <p className="eyebrow">Inventory</p>
            <h2 id="product-form-title">{editing ? "Edit product" : "Add product"}</h2>
          </div>
          <button className="icon-button" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <form className="product-form" onSubmit={submit}>
          <label className="field-span-two">
            Product name <span className="required-mark">*</span>
            <input maxLength="160" value={form.product_name} onChange={(event) => change("product_name", event.target.value)} required />
          </label>
          <label>
            Barcode
            <input maxLength="128" value={form.barcode || ""} onChange={(event) => change("barcode", event.target.value)} />
          </label>
          <label>
            Category
            <input maxLength="100" value={form.category || ""} onChange={(event) => change("category", event.target.value)} />
          </label>
          <label>
            Brand
            <input maxLength="100" value={form.brand || ""} onChange={(event) => change("brand", event.target.value)} />
          </label>
          <label>
            Purchase price
            <input type="number" min="0" step="0.01" value={form.purchase_price} onChange={(event) => change("purchase_price", event.target.value)} />
          </label>
          <label>
            Selling price
            <input type="number" min="0" step="0.01" value={form.selling_price} onChange={(event) => change("selling_price", event.target.value)} />
          </label>
          <label>
            Current stock
            <input type="number" min="0" step="1" value={form.current_stock} onChange={(event) => change("current_stock", event.target.value)} />
          </label>
          <label>
            Minimum stock
            <input type="number" min="0" step="1" value={form.minimum_stock} onChange={(event) => change("minimum_stock", event.target.value)} />
          </label>
          <label>
            Expiry date
            <input type="date" value={form.expiry_date || ""} onChange={(event) => change("expiry_date", event.target.value)} />
          </label>
          <label className="field-span-two">
            Product image URL
            <input type="url" maxLength="2048" placeholder="https://…" value={form.product_image || ""} onChange={(event) => change("product_image", event.target.value)} />
          </label>
          {error && <p className="form-error field-span-two" role="alert">{error}</p>}
          <div className="form-actions field-span-two">
            <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
            <button className="primary-button" disabled={saving}>{saving ? "Saving…" : editing ? "Save changes" : "Add product"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function ProductDetails({ product, deleting, onClose, onEdit, onDelete }) {
  const details = [
    ["Product ID", product.product_id],
    ["Product name", product.product_name],
    ["Barcode", product.barcode || "—"],
    ["Category", product.category || "—"],
    ["Brand", product.brand || "—"],
    ["Purchase price", currency(product.purchase_price)],
    ["Selling price", currency(product.selling_price)],
    ["Current stock", product.current_stock],
    ["Minimum stock", product.minimum_stock],
    ["Stock status", product.stock_status],
    ["Expiry date", displayDate(product.expiry_date)],
    ["Expiry status", expiryStatusLabel(product.expiry_status)],
    ["Days to expiry", product.days_to_expiry ?? "—"],
    ["Product image", product.product_image || "—"],
    ["Created at", new Date(product.created_at).toLocaleString()],
    ["Updated at", new Date(product.updated_at).toLocaleString()],
  ];

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="product-modal details-modal" role="dialog" aria-modal="true" aria-labelledby="product-details-title">
        <div className="modal-heading">
          <div>
            <p className="eyebrow">Product details</p>
            <h2 id="product-details-title">{product.product_name}</h2>
          </div>
          <button className="icon-button" aria-label="Close" onClick={onClose}>×</button>
        </div>
        {product.product_image && (
          <img className="product-image-preview" src={product.product_image} alt={product.product_name} />
        )}
        <dl className="product-detail-list">
          {details.map(([label, value]) => (
            <div className="detail-row" key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <div className="form-actions">
          <button className="danger-button" onClick={onDelete} disabled={deleting}>
            {deleting ? "Deleting…" : "Delete"}
          </button>
          <button className="secondary-button" onClick={onClose}>Close</button>
          <button className="primary-button" onClick={onEdit}>Edit product</button>
        </div>
      </section>
    </div>
  );
}
