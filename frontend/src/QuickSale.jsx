import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "./api.js";

const paymentMethods = ["CASH", "UPI", "CARD"];

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function cents(value) {
  const match = String(value ?? "").match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return 0n;
  return BigInt(match[1]) * 100n + BigInt((match[2] || "").padEnd(2, "0"));
}

function formatMoney(value) {
  const amount = typeof value === "bigint" ? value : cents(value);
  return `₹${amount / 100n}.${String(amount % 100n).padStart(2, "0")}`;
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "—" : date.toLocaleString();
}

function formatDateOnly(value) {
  if (!value) return "—";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(date.valueOf())
    ? "—"
    : date.toLocaleDateString(undefined, { timeZone: "UTC" });
}

function expiryLabel(product) {
  if (!product.expiry_date) return "No expiry date";
  if (product.expiry_status === "EXPIRED") return "Expired";
  if (product.expiry_status === "EXPIRING_SOON_7_DAYS") return "Expiring in 7 days";
  if (product.expiry_status === "EXPIRING_30_DAYS") return "Expiring in 8–30 days";
  return "Safe";
}

export default function QuickSalePage({ isOwner = false }) {
  const [barcode, setBarcode] = useState("");
  const [product, setProduct] = useState(null);
  const [expiredConfirmed, setExpiredConfirmed] = useState(false);
  const [quantity, setQuantity] = useState("1");
  const [cart, setCart] = useState([]);
  const [paymentMethod, setPaymentMethod] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchingNames, setSearchingNames] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [sales, setSales] = useState([]);
  const [salesLoading, setSalesLoading] = useState(isOwner);
  const [historyError, setHistoryError] = useState("");
  const [selectedSale, setSelectedSale] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const barcodeInput = useRef(null);

  const loadSales = useCallback(async (signal) => {
    if (!isOwner) return;
    setSalesLoading(true);
    setHistoryError("");
    try {
      const response = await apiFetch("/api/sales/history?limit=50", {
        credentials: "same-origin",
        signal,
      });
      const result = await readJson(response);
      if (!response.ok) throw new Error(result.error || "Could not load sales history.");
      setSales(result.sales);
    } catch (loadError) {
      if (loadError.name !== "AbortError") setHistoryError(loadError.message);
    } finally {
      if (!signal.aborted) setSalesLoading(false);
    }
  }, [isOwner]);

  useEffect(() => {
    barcodeInput.current?.focus();
    if (!isOwner) return undefined;
    const controller = new AbortController();
    void loadSales(controller.signal);
    return () => controller.abort();
  }, [isOwner, loadSales]);

  async function findByBarcode(event) {
    event.preventDefault();
    const value = barcode.trim();
    setError("");
    setNotice("");
    setNotFound(false);
    setSearchResults([]);
    setProduct(null);
    setExpiredConfirmed(false);
    if (!value) {
      setError("Scan or enter a barcode.");
      barcodeInput.current?.focus();
      return;
    }
    setSearching(true);
    try {
      const response = await apiFetch(`/api/sales/product/${encodeURIComponent(value)}`, {
        credentials: "same-origin",
      });
      const result = await readJson(response);
      if (response.status === 404) {
        setNotFound(true);
        setError("Product not found. Search by product name.");
        return;
      }
      if (!response.ok) throw new Error(result.error || "Could not find product.");
      setProduct(result.product);
      setQuantity("1");
    } catch (lookupError) {
      setError(lookupError.message);
    } finally {
      setSearching(false);
      barcodeInput.current?.focus();
    }
  }

  async function searchByName(event) {
    event.preventDefault();
    const value = searchTerm.trim();
    setError("");
    setNotice("");
    if (!value) {
      setError("Enter a product name, barcode, category, or brand to search.");
      return;
    }
    setSearchingNames(true);
    try {
      const response = await apiFetch(`/api/sales/products?search=${encodeURIComponent(value)}`, {
        credentials: "same-origin",
      });
      const result = await readJson(response);
      if (!response.ok) throw new Error(result.error || "Could not search products.");
      setSearchResults(result.products);
      if (!result.products.length) setNotice("No matching products found.");
    } catch (searchError) {
      setError(searchError.message);
    } finally {
      setSearchingNames(false);
    }
  }

  function addToCart(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!product) return;
    if (!/^\d+$/.test(quantity.trim()) || Number(quantity) < 1) {
      setError("Sale quantity must be a positive whole number.");
      return;
    }
    if (product.expiry_status === "EXPIRED" && !expiredConfirmed) {
      setError("Confirm the expired-product warning before adding this product to the sale.");
      return;
    }
    const requested = Number(quantity);
    const existing = cart.find((item) => item.product_id === product.product_id);
    const combined = requested + (existing?.quantity ?? 0);
    if (product.current_stock === 0) {
      setError("Out of stock.");
      return;
    }
    if (combined > product.current_stock) {
      setError(`Only ${Math.max(product.current_stock - (existing?.quantity ?? 0), 0)} items available to add.`);
      return;
    }
    setCart((current) => {
      const item = current.find((entry) => entry.product_id === product.product_id);
      if (!item) return [...current, { ...product, quantity: requested }];
      return current.map((entry) =>
        entry.product_id === product.product_id
          ? { ...entry, quantity: entry.quantity + requested }
          : entry,
      );
    });
    setProduct(null);
    setExpiredConfirmed(false);
    setBarcode("");
    setQuantity("1");
    setSearchResults([]);
    setNotFound(false);
    setNotice(`${product.product_name} added to cart.`);
    barcodeInput.current?.focus();
  }

  function adjustCartItem(productId, change) {
    setCart((current) => current.map((item) =>
      item.product_id === productId
        ? { ...item, quantity: Math.max(1, Math.min(item.current_stock, item.quantity + change)) }
        : item,
    ));
  }

  async function completeSale(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!cart.length) {
      setError("Add at least one product before completing the sale.");
      return;
    }
    if (!paymentMethod) {
      setError("Select a payment method.");
      return;
    }
    setSubmitting(true);
    try {
      const response = await apiFetch("/api/sales", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: cart.map(({ product_id, quantity: itemQuantity }) => ({
            product_id,
            quantity: itemQuantity,
          })),
          payment_method: paymentMethod,
        }),
      });
      const result = await readJson(response);
      if (!response.ok) {
        if (response.status === 409) {
          await refreshCartProducts();
        }
        throw new Error(result.error || "Could not complete sale.");
      }
      setReceipt(result.sale);
      setCart([]);
      setProduct(null);
      setPaymentMethod("");
      setBarcode("");
      setSearchResults([]);
      setNotice("");
      await loadSales(new AbortController().signal);
    } catch (saleError) {
      setError(saleError.message);
    } finally {
      setSubmitting(false);
      barcodeInput.current?.focus();
    }
  }

  async function refreshCartProducts() {
    const refreshed = await Promise.all(cart.map(async (item) => {
      const response = await apiFetch(
        `/api/sales/products/${item.product_id}`,
        { credentials: "same-origin" },
      );
      if (!response.ok) return item;
      const result = await readJson(response);
      return { ...item, ...result.product };
    }));
    setCart(refreshed);
  }

  async function openSaleDetails(saleId) {
    setDetailsLoading(true);
    setHistoryError("");
    try {
      const response = await apiFetch(`/api/sales/${saleId}`, {
        credentials: "same-origin",
      });
      const result = await readJson(response);
      if (!response.ok) throw new Error(result.error || "Could not load sale details.");
      setSelectedSale(result.sale);
    } catch (detailError) {
      setHistoryError(detailError.message);
    } finally {
      setDetailsLoading(false);
    }
  }

  const cartTotal = cart.reduce(
    (sum, item) => sum + cents(item.selling_price) * BigInt(item.quantity),
    0n,
  );

  return (
    <div className="quick-sale">
      {receipt ? (
        <section className="sale-receipt content-card" aria-labelledby="sale-completed-title">
          <div className="card-icon" aria-hidden="true">✓</div>
          <p className="eyebrow">Transaction complete</p>
          <h2 id="sale-completed-title">Sale completed successfully</h2>
          <dl className="product-detail-list receipt-details">
            <Detail label="Sale ID" value={receipt.sale_id} />
            <Detail label="Date / Time" value={formatDate(receipt.sold_at)} />
            <Detail label="Payment" value={receipt.payment_method} />
            <Detail label="Sold by" value={receipt.sold_by} />
          </dl>
          <div className="sale-receipt-items">
            {receipt.items.map((item) => (
              <div className="sale-receipt-line" key={item.product_id}>
                <span>{item.product_name} · {item.quantity} × {formatMoney(item.unit_price)}</span>
                <strong>{formatMoney(item.subtotal)}</strong>
              </div>
            ))}
          </div>
          <div className="sale-total-row receipt-total">
            <strong>Total</strong><strong>{formatMoney(receipt.total_amount)}</strong>
          </div>
          <p className="locator-notice">Stock updated successfully.</p>
          <button className="primary-button" onClick={() => {
            setReceipt(null);
            window.requestAnimationFrame(() => barcodeInput.current?.focus());
          }}>
            New Sale
          </button>
        </section>
      ) : (
        <>
          <div className="inventory-toolbar">
            <div>
              <h2>Quick Sale</h2>
              <p className="inventory-subtitle">Scan or enter a product barcode to start a sale.</p>
            </div>
          </div>

          {error && <p className="inventory-error" role="alert">{error}</p>}
          {notice && <p className="locator-notice" role="status">{notice}</p>}

          <section className="sale-card content-card" aria-labelledby="sale-barcode-title">
            <h3 id="sale-barcode-title">Find a product</h3>
            <form className="sale-barcode-form" onSubmit={findByBarcode}>
              <label className="search-field">
                <span>Barcode</span>
                <input
                  ref={barcodeInput}
                  type="search"
                  value={barcode}
                  placeholder="Scan or enter barcode"
                  autoComplete="off"
                  onChange={(event) => setBarcode(event.target.value)}
                />
              </label>
              <button className="primary-button" disabled={searching}>
                {searching ? "Searching…" : "Search barcode"}
              </button>
            </form>
            {(notFound || searchResults.length > 0) && (
              <form className="sale-name-search" onSubmit={searchByName}>
                <label className="search-field">
                  <span>Search by product name</span>
                  <input
                    type="search"
                    value={searchTerm}
                    placeholder="Name, barcode, category, or brand"
                    onChange={(event) => setSearchTerm(event.target.value)}
                  />
                </label>
                <button className="secondary-button" disabled={searchingNames}>
                  {searchingNames ? "Searching…" : "Search products"}
                </button>
              </form>
            )}
            {searchResults.length > 0 && (
              <div className="sale-search-results" aria-label="Product search results">
                {searchResults.map((result) => (
                  <button
                    className="sale-search-result"
                    key={result.product_id}
                    onClick={() => {
                      setProduct(result);
                      setExpiredConfirmed(false);
                      setQuantity("1");
                      setError("");
                    }}
                  >
                    <span><strong>{result.product_name}</strong><small>{result.barcode || "No barcode"}</small></span>
                  <span>
                    {formatMoney(result.selling_price)} · Stock {result.current_stock}
                    <small>{expiryLabel(result)}</small>
                  </span>
                  </button>
                ))}
              </div>
            )}
            {product && (
              <form className="sale-product-result" onSubmit={addToCart}>
                <div className="sale-product-heading">
                  <div>
                    <p className="eyebrow">Product found</p>
                    <h3>{product.product_name}</h3>
                  </div>
                  <button className="text-button" type="button" onClick={() => {
                    setProduct(null);
                    setExpiredConfirmed(false);
                    setBarcode("");
                    barcodeInput.current?.focus();
                  }}>
                    Clear
                  </button>
                </div>
                <dl className="product-detail-list">
                  <Detail label="Barcode" value={product.barcode || "—"} />
                  <Detail label="Category" value={product.category || "—"} />
                  <Detail label="Brand" value={product.brand || "—"} />
                  <Detail label="Selling price" value={formatMoney(product.selling_price)} />
                  <Detail label="Available stock" value={product.current_stock} />
                  <Detail label="Expiry date" value={formatDateOnly(product.expiry_date)} />
                  <Detail label="Expiry status" value={expiryLabel(product)} />
                  <Detail label="Days to expiry" value={product.days_to_expiry ?? "—"} />
                  <Detail label="Location" value={product.rack_code
                    ? `Rack ${product.rack_code} · Shelf ${product.shelf_code}`
                    : "Location not assigned"} />
                </dl>
                {product.expiry_status === "EXPIRED" && (
                  <div className="sale-expiry-warning" role="alert">
                    <p>Warning: This product is expired. Review the expiry date and confirm below before adding it to the sale.</p>
                    <label className="expired-sale-confirmation">
                      <input
                        type="checkbox"
                        checked={expiredConfirmed}
                        onChange={(event) => {
                          setExpiredConfirmed(event.target.checked);
                          setError("");
                        }}
                      />
                      I have reviewed the expiry date and want to add this product to the sale.
                    </label>
                  </div>
                )}
                {product.expiry_status === "EXPIRING_SOON_7_DAYS" && (
                  <p className="sale-expiry-notice" role="status">
                    This product expires within 7 days.
                  </p>
                )}
                {product.current_stock === 0 ? (
                  <p className="sale-stock-error" role="alert">Out of stock.</p>
                ) : (
                  <div className="sale-add-controls">
                    <label>
                      Quantity
                      <input
                        type="number"
                        min="1"
                        max={product.current_stock}
                        step="1"
                        value={quantity}
                        onChange={(event) => setQuantity(event.target.value)}
                        required
                      />
                    </label>
                    <button className="primary-button" disabled={!quantity || Number(quantity) < 1}>
                      Add to Cart
                    </button>
                  </div>
                )}
              </form>
            )}
          </section>

          <section className="sale-card content-card" aria-labelledby="cart-title">
            <div className="sale-card-heading">
              <div>
                <h3 id="cart-title">Cart</h3>
                <p className="inventory-subtitle">{cart.length} products</p>
              </div>
              {cart.length > 0 && (
                <button className="text-button" onClick={() => {
                  setCart([]);
                  setError("");
                }}>Clear cart</button>
              )}
            </div>
            <div className="inventory-table-wrap">
              <table className="inventory-table sale-cart-table">
                <thead>
                  <tr><th>Product</th><th>Quantity</th><th>Price</th><th>Subtotal</th><th>Action</th></tr>
                </thead>
                <tbody>
                  {cart.length === 0 ? (
                    <tr><td className="table-message" colSpan="5">Cart is empty.</td></tr>
                  ) : cart.map((item) => (
                    <tr key={item.product_id}>
                      <td>{item.product_name}<small className="table-secondary">{item.barcode || "No barcode"}</small></td>
                      <td>
                        <div className="sale-quantity-controls">
                          <button aria-label={`Decrease ${item.product_name}`} onClick={() => adjustCartItem(item.product_id, -1)}>−</button>
                          <strong>{item.quantity}</strong>
                          <button
                            aria-label={`Increase ${item.product_name}`}
                            disabled={item.quantity >= item.current_stock}
                            onClick={() => adjustCartItem(item.product_id, 1)}
                          >+</button>
                        </div>
                      </td>
                      <td>{formatMoney(item.selling_price)}</td>
                      <td>{formatMoney(cents(item.selling_price) * BigInt(item.quantity))}</td>
                      <td><button className="text-button" onClick={() => setCart((current) => current.filter((row) => row.product_id !== item.product_id))}>Remove</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="sale-total-row">
              <strong>Total</strong><strong>{formatMoney(cartTotal)}</strong>
            </div>
            <form className="sale-checkout" onSubmit={completeSale}>
              <fieldset>
                <legend>Payment method</legend>
                <div className="sale-payment-options">
                  {paymentMethods.map((method) => (
                    <label key={method}>
                      <input
                        type="radio"
                        name="payment-method"
                        value={method}
                        checked={paymentMethod === method}
                        onChange={() => setPaymentMethod(method)}
                      />
                      {method}
                    </label>
                  ))}
                </div>
              </fieldset>
              <button className="primary-button sale-complete-button" disabled={submitting || cart.length === 0 || !paymentMethod}>
                {submitting ? "Completing sale…" : "Complete Sale"}
              </button>
            </form>
          </section>
        </>
      )}

      {isOwner && (
        <section className="sale-card content-card" aria-labelledby="sales-history-title">
          <div className="sale-card-heading">
            <div>
              <h3 id="sales-history-title">Sales history</h3>
              <p className="inventory-subtitle">Recent completed sales.</p>
            </div>
          </div>
          {historyError && <p className="inventory-error" role="alert">{historyError}</p>}
          <div className="inventory-table-wrap">
            <table className="inventory-table sales-history-table">
              <thead><tr><th>Sale ID</th><th>Total</th><th>Payment</th><th>Sold By</th><th>Date / Time</th><th>Details</th></tr></thead>
              <tbody>
                {salesLoading ? (
                  <tr><td className="table-message" colSpan="6">Loading sales…</td></tr>
                ) : sales.length === 0 ? (
                  <tr><td className="table-message" colSpan="6">No sales recorded yet.</td></tr>
                ) : sales.map((sale) => (
                  <tr key={sale.sale_id}>
                    <td>{sale.sale_id}</td>
                    <td>{formatMoney(sale.total_amount)}</td>
                    <td>{sale.payment_method}</td>
                    <td>{sale.sold_by}</td>
                    <td>{formatDate(sale.sold_at)}</td>
                    <td><button className="text-button" onClick={() => void openSaleDetails(sale.sale_id)}>View</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {isOwner && selectedSale && (
        <div className="modal-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setSelectedSale(null);
        }}>
          <section className="product-modal details-modal" role="dialog" aria-modal="true" aria-labelledby="sale-details-title">
            <div className="modal-heading">
              <h2 id="sale-details-title">Sale details</h2>
              <button className="icon-button" aria-label="Close" onClick={() => setSelectedSale(null)}>×</button>
            </div>
            {detailsLoading ? (
              <p className="muted">Loading sale details…</p>
            ) : (
              <>
                <dl className="product-detail-list">
                  <Detail label="Sale ID" value={selectedSale.sale_id} />
                  <Detail label="Payment" value={selectedSale.payment_method} />
                  <Detail label="Sold by" value={selectedSale.sold_by} />
                  <Detail label="Date / Time" value={formatDate(selectedSale.sold_at)} />
                </dl>
                <div className="inventory-table-wrap">
                  <table className="inventory-table sale-cart-table">
                    <thead><tr><th>Product</th><th>Qty</th><th>Unit price</th><th>Subtotal</th></tr></thead>
                    <tbody>
                      {selectedSale.items.map((item) => (
                        <tr key={item.sale_item_id}>
                          <td>{item.product_name}</td>
                          <td>{item.quantity}</td>
                          <td>{formatMoney(item.unit_price)}</td>
                          <td>{formatMoney(item.subtotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="sale-total-row">
                  <strong>Total</strong><strong>{formatMoney(selectedSale.total_amount)}</strong>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function Detail({ label, value }) {
  return <div className="detail-row"><dt>{label}</dt><dd>{value}</dd></div>;
}
