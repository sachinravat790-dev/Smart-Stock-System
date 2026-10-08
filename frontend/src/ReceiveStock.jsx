import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "./api.js";

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function displayDate(value) {
  return new Date(value).toLocaleString();
}

function money(value) {
  return Number(value).toFixed(2);
}

export default function ReceiveStockPage() {
  const [barcode, setBarcode] = useState("");
  const [product, setProduct] = useState(null);
  const [productNotFound, setProductNotFound] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const [quantity, setQuantity] = useState("");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [supplier, setSupplier] = useState("");
  const [newProduct, setNewProduct] = useState({
    product_name: "",
    category: "",
    brand: "",
    selling_price: "",
    minimum_stock: "0",
    expiry_date: "",
    product_image: "",
  });
  const [history, setHistory] = useState([]);
  const [historyError, setHistoryError] = useState("");
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadHistory = useCallback(async (signal) => {
    setLoadingHistory(true);
    setHistoryError("");
    try {
      const response = await apiFetch("/api/receiving/history?limit=50", {
        credentials: "same-origin",
        signal,
      });
      const result = await readJson(response);
      if (!response.ok) throw new Error(result.error || "Could not load receiving history.");
      setHistory(result.receivingHistory);
    } catch (loadError) {
      if (loadError.name !== "AbortError") setHistoryError(loadError.message);
    } finally {
      if (!signal.aborted) setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadHistory(controller.signal);
    return () => controller.abort();
  }, [loadHistory]);

  async function searchBarcode(event) {
    event.preventDefault();
    setProduct(null);
    setProductNotFound(false);
    setLookupError("");
    setMessage("");
    setError("");
    setQuantity("");
    setSupplier("");
    setNewProduct({
      product_name: "",
      category: "",
      brand: "",
      selling_price: "",
      minimum_stock: "0",
      expiry_date: "",
      product_image: "",
    });
    const normalizedBarcode = barcode.trim();
    if (!normalizedBarcode) {
      setLookupError("Enter a barcode to search.");
      return;
    }

    setSearching(true);
    try {
      const response = await apiFetch(
        `/api/receiving/lookup?barcode=${encodeURIComponent(normalizedBarcode)}`,
        { credentials: "same-origin" },
      );
      const result = await readJson(response);
      if (!response.ok) throw new Error(result.error || "Could not search this barcode.");
      if (result.found) {
        setProduct(result.product);
        setPurchasePrice(String(result.product.purchase_price ?? ""));
      } else {
        setProductNotFound(true);
        setNewProduct((current) => ({ ...current }));
        setPurchasePrice("");
      }
    } catch (searchError) {
      setLookupError(searchError.message);
    } finally {
      setSearching(false);
    }
  }

  async function submitReceiving(event) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    setMessage("");

    const body = {
      barcode: barcode.trim(),
      quantity,
      purchase_price: purchasePrice,
      supplier,
    };
    if (product) body.product_id = product.product_id;
    else body.product = undefined;

    if (!product) {
      Object.assign(body, newProduct, {
        barcode: barcode.trim(),
        quantity,
        purchase_price: purchasePrice,
        supplier,
      });
    }

    try {
      const response = await apiFetch("/api/receiving", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await readJson(response);
      if (!response.ok) {
        if (response.status === 409) {
          setProductNotFound(false);
          setProduct(null);
          setLookupError("This barcode was just added. Search it again to receive stock for the existing product.");
        }
        throw new Error(result.error || "Could not receive stock.");
      }

      setProduct(result.product);
      setProductNotFound(false);
      setQuantity("");
      setSupplier("");
      setPurchasePrice(String(result.product.purchase_price ?? body.purchase_price));
      setMessage(
        `${result.receiving.quantity} units received. Current stock is now ${result.product.current_stock}.`,
      );
      await loadHistory(new AbortController().signal);
    } catch (receiveError) {
      setError(receiveError.message);
    } finally {
      setSubmitting(false);
    }
  }

  function updateNewProduct(field, value) {
    setNewProduct((current) => ({ ...current, [field]: value }));
  }

  return (
    <div className="receiving-page">
      <section className="receiving-card">
        <div className="receiving-heading">
          <div>
            <h2>Receive Stock</h2>
            <p>Scan a barcode or enter it manually to find or create a product.</p>
          </div>
          <span className="manual-entry-tag">Manual barcode entry available</span>
        </div>

        <form className="barcode-search-form" onSubmit={searchBarcode}>
          <label htmlFor="receiving-barcode">Barcode</label>
          <div className="barcode-search-row">
            <input
              id="receiving-barcode"
              value={barcode}
              maxLength={128}
              autoComplete="off"
              placeholder="Enter or scan barcode"
              onChange={(event) => setBarcode(event.target.value)}
              required
            />
            <button className="primary-button" disabled={searching}>
              {searching ? "Searching…" : "Search"}
            </button>
          </div>
          {lookupError && <p className="form-error" role="alert">{lookupError}</p>}
        </form>

        {product && (
          <form className="receiving-form" onSubmit={submitReceiving}>
            <h3>Product found</h3>
            <div className="receiving-product-summary">
              <div><span>Product name</span><strong>{product.product_name}</strong></div>
              <div><span>Barcode</span><strong>{product.barcode}</strong></div>
              <div><span>Category</span><strong>{product.category || "—"}</strong></div>
              <div><span>Brand</span><strong>{product.brand || "—"}</strong></div>
              <div><span>Current stock</span><strong>{product.current_stock}</strong></div>
              <div><span>Purchase price</span><strong>{money(product.purchase_price)}</strong></div>
              <div><span>Selling price</span><strong>{money(product.selling_price)}</strong></div>
              <div><span>Expiry date</span><strong>{product.expiry_date || "—"}</strong></div>
            </div>
            <div className="receiving-inputs">
              <label>
                Received quantity
                <input type="number" min="1" step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} required />
              </label>
              <label>
                Purchase price
                <input type="number" min="0" step="0.01" value={purchasePrice} onChange={(event) => setPurchasePrice(event.target.value)} required />
              </label>
              <label className="receiving-supplier">
                Supplier (optional)
                <input maxLength="160" value={supplier} onChange={(event) => setSupplier(event.target.value)} />
              </label>
            </div>
            {error && <p className="form-error" role="alert">{error}</p>}
            {message && <p className="success-message" role="status">{message}</p>}
            <button className="primary-button receive-submit" disabled={submitting}>
              {submitting ? "Saving…" : "Receive stock"}
            </button>
          </form>
        )}

        {productNotFound && (
          <form className="receiving-form" onSubmit={submitReceiving}>
            <h3>New product</h3>
            <div className="receiving-product-summary barcode-summary">
              <div><span>Barcode</span><strong>{barcode.trim()}</strong></div>
            </div>
            <div className="receiving-inputs">
              <label className="receiving-input-wide">
                Product name
                <input maxLength="160" value={newProduct.product_name} onChange={(event) => updateNewProduct("product_name", event.target.value)} required />
              </label>
              <label>
                Category
                <input maxLength="100" value={newProduct.category} onChange={(event) => updateNewProduct("category", event.target.value)} required />
              </label>
              <label>
                Brand
                <input maxLength="100" value={newProduct.brand} onChange={(event) => updateNewProduct("brand", event.target.value)} required />
              </label>
              <label>
                Purchase price
                <input type="number" min="0" step="0.01" value={purchasePrice} onChange={(event) => setPurchasePrice(event.target.value)} required />
              </label>
              <label>
                Selling price
                <input type="number" min="0" step="0.01" value={newProduct.selling_price} onChange={(event) => updateNewProduct("selling_price", event.target.value)} required />
              </label>
              <label>
                Received quantity
                <input type="number" min="1" step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} required />
              </label>
              <label>
                Minimum stock
                <input type="number" min="0" step="1" value={newProduct.minimum_stock} onChange={(event) => updateNewProduct("minimum_stock", event.target.value)} required />
              </label>
              <label>
                Expiry date (optional)
                <input type="date" value={newProduct.expiry_date} onChange={(event) => updateNewProduct("expiry_date", event.target.value)} />
              </label>
              <label>
                Supplier (optional)
                <input maxLength="160" value={supplier} onChange={(event) => setSupplier(event.target.value)} />
              </label>
              <label className="receiving-input-wide">
                Product image URL (optional)
                <input type="url" maxLength="2048" placeholder="https://…" value={newProduct.product_image} onChange={(event) => updateNewProduct("product_image", event.target.value)} />
              </label>
            </div>
            {error && <p className="form-error" role="alert">{error}</p>}
            {message && <p className="success-message" role="status">{message}</p>}
            <button className="primary-button receive-submit" disabled={submitting}>
              {submitting ? "Saving…" : "Create & receive"}
            </button>
          </form>
        )}
      </section>

      <section className="receiving-card history-card">
        <div className="receiving-heading history-heading">
          <div>
            <h2>Receiving history</h2>
            <p>Recent stock receipts recorded by the signed-in team.</p>
          </div>
        </div>
        {historyError && <p className="form-error" role="alert">{historyError}</p>}
        <div className="inventory-table-wrap">
          <table className="inventory-table receiving-history-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Barcode</th>
                <th>Quantity</th>
                <th>Purchase Price</th>
                <th>Supplier</th>
                <th>Received By</th>
                <th>Date/Time</th>
              </tr>
            </thead>
            <tbody>
              {loadingHistory ? (
                <tr><td className="table-message" colSpan="7">Loading receiving history…</td></tr>
              ) : history.length === 0 ? (
                <tr><td className="table-message" colSpan="7">No receiving transactions yet.</td></tr>
              ) : history.map((receipt) => (
                <tr key={receipt.receiving_id}>
                  <td>{receipt.product_name}</td>
                  <td>{receipt.barcode}</td>
                  <td>{receipt.quantity}</td>
                  <td>{money(receipt.purchase_price)}</td>
                  <td>{receipt.supplier || "—"}</td>
                  <td>{receipt.received_by}</td>
                  <td>{displayDate(receipt.received_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
