# SmartStock

SmartStock is a small-shop inventory application. It includes secure
Owner/Staff access, product inventory, stock receiving, and a product locator
for managing rack and shelf locations in the existing Supabase PostgreSQL
database.

## Technology stack

- Frontend: React and Vite
- Backend: Node.js and Express
- Database: Supabase PostgreSQL, accessed by the backend with `pg`
- Authentication: bcrypt password hashes and PostgreSQL-backed HTTP sessions

## Folder structure

```text
Smart-Stock-System/
├── backend/
│   ├── src/
│   │   ├── app.js
│   │   ├── ai-assistant.js
│   │   ├── assistant-data.js
│   │   ├── assistant-service.js
│   │   ├── assistant-validation.js
│   │   ├── access.js
│   │   ├── auth.js
│   │   ├── auth-middleware.js
│   │   ├── config.js
│   │   ├── create-user.js
│   │   ├── database.js
│   │   ├── location-validation.js
│   │   ├── migrate.js
│   │   ├── product-locations.js
│   │   ├── product-validation.js
│   │   ├── product-status.js
│   │   ├── products.js
│   │   ├── payment-reconciliation.js
│   │   ├── payment-reconciliation-validation.js
│   │   ├── staff-activities.js
│   │   ├── staff-activity.js
│   │   ├── receiving-validation.js
│   │   ├── receiving.js
│   │   ├── sales-validation.js
│   │   ├── sales.js
│   │   ├── stock-audit-validation.js
│   │   ├── stock-audits.js
│   │   └── server.js
│   ├── test/
│   │   ├── access.test.js
│   │   ├── location-validation.test.js
│   │   ├── product-validation.test.js
│   │   ├── product-status.test.js
│   │   ├── receiving-validation.test.js
│   │   ├── sales-validation.test.js
│   │   ├── payment-reconciliation-validation.test.js
│   │   ├── staff-activities.test.js
│   │   └── stock-audit-validation.test.js
│   └── package.json
├── database/
│   ├── migrations/
│   │   ├── 001_auth_users.sql
│   │   ├── 002_products.sql
│   │   ├── 003_receiving_history.sql
│   │   ├── 004_product_locations.sql
│   │   ├── 005_sales.sql
│   │   ├── 006_stock_audits.sql
│   │   ├── 007_payment_reconciliations.sql
│   │   └── 008_staff_activities.sql
│   └── README.md
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── AIAssistant.jsx
│   │   ├── api.js
│   │   ├── ExpiryAlerts.jsx
│   │   ├── Inventory.jsx
│   │   ├── main.jsx
│   │   ├── ProductLocator.jsx
│   │   ├── PaymentReconciliation.jsx
│   │   ├── QuickSale.jsx
│   │   ├── ReceiveStock.jsx
│   │   ├── StockAudit.jsx
│   │   ├── StaffActivity.jsx
│   │   └── styles.css
│   ├── index.html
│   ├── package.json
│   ├── .env.example
│   └── vite.config.js
├── .env.example
├── .gitignore
└── README.md
```

## Requirements

- Node.js 20 or newer
- npm
- A Supabase project with its PostgreSQL connection string

## Install dependencies

Run these commands from the project root:

```sh
npm --prefix backend install
npm --prefix frontend install
```

## Configure Supabase and environment variables

1. In the Supabase dashboard, open your project’s **Connect** settings and copy
   a PostgreSQL connection string. Prefer the session pooler if your network
   does not support direct IPv6 database connections.
2. Create the backend `.env` from the example:

   ```sh
   cp .env.example backend/.env
   ```

3. Set `SUPABASE_DB_URL` in `backend/.env` to your actual PostgreSQL connection string.
   Preserve URL-encoding for special characters in the password.
4. Set `SESSION_SECRET` to at least 32 random bytes (for example, generate one
   with `openssl rand -base64 48`).
5. For local development, `.env` may be placed in `backend/.env` (preferred)
   or at the project root. Keep it private; both locations are excluded by
   `.gitignore`.
6. To use Phase 12, configure `AI_API_KEY` for an OpenAI or
   OpenAI-compatible chat-completions provider. `AI_PROVIDER`, `AI_MODEL`, and
   `AI_BASE_URL` select the provider format, model, and API base URL. These
   values are read only by the backend; never add a provider key to the
   frontend.

`PORT` defaults to `3001` and `FRONTEND_ORIGIN` defaults to
`http://localhost:5173` in development. The database connection uses TLS.
Session cookies are HttpOnly and use SameSite=Lax; production cookies are
marked Secure. The session secret must be at least 32 bytes and remain stable
between backend restarts.

## Production deployment configuration

Set backend environment variables in the hosting platform (never commit their
values):

- `PORT` — supplied by the host; defaults safely to `3001`.
- `SUPABASE_DB_URL` — Supabase PostgreSQL connection URL. `DATABASE_URL` is
  also accepted when `SUPABASE_DB_URL` is not set.
- `SESSION_SECRET` — at least 32 bytes.
- `FRONTEND_ORIGIN` — exact frontend origin(s), comma-separated when needed;
  do not use `*`. In production there is no localhost CORS fallback.
- `AI_API_KEY` — required only for the Phase 12 assistant.
- `AI_PROVIDER`, `AI_MODEL`, and `AI_BASE_URL` — optional AI provider settings.

Build the frontend with `npm --prefix frontend run build`; serve the generated
`frontend/dist` directory using a static host. Start the backend with
`npm --prefix backend start` (equivalent to `node src/server.js` from
`backend/`). Set `NODE_ENV=production` on the backend so secure session cookies
and trusted-proxy behavior are enabled.

By default the frontend calls `/api` on its own origin, so route that path to
the backend through the production reverse proxy/host. For a separately hosted
API, set `VITE_API_BASE_URL` at frontend build time to its API origin, and set
`FRONTEND_ORIGIN` on the backend to the exact frontend origin. Deploy frontend
and API on the same site (same scheme and registrable domain) so the existing
SameSite=Lax session cookie works. For local development, Vite continues
proxying to `http://localhost:3001`; override that with
`VITE_API_PROXY_TARGET` if needed. See `frontend/.env.example`.

Production commands:

```sh
npm --prefix backend start
npm --prefix frontend run build
```

## Apply database schema and create accounts

Apply the ordered database migrations for the implemented schemas:

```sh
npm --prefix backend run db:migrate
```

Create real Owner and Staff accounts from an interactive terminal. The
password is entered without terminal echo and is stored only as a bcrypt hash:

```sh
npm --prefix backend run user:create
```

The command asks for a name, email, role (`owner` or `staff`), and password.
There is no public registration endpoint.

To reset the password hash for the single Staff account without changing its
email, name, or role, use this command in an interactive terminal. Password
input is hidden:

```sh
npm --prefix backend run user:reset-staff
```

## Phase 1 access

- Owner navigation: Dashboard, Inventory, Receive Stock, Sales, Find Product,
  Expiry, Audit, Payments, Staff Activity, Reports, AI Assistant.
- Staff navigation: Quick Sale, Receive Stock, Find Product.
- Login sessions and the section authorization API are enforced by the backend.
- Inventory, Receive Stock, and Find Product now have the functionality
  described in Phases 2–4; Quick Sale, alerts, stock audit, and payment
  reconciliation are implemented. Other sections remain access-control
  placeholders.

## Phase 2 product inventory

Owners can add, view, edit, delete, search, and filter real product records on
the Inventory page. Product API routes enforce Owner authorization on the
backend. Staff can neither view nor modify the inventory API in Phase 2.

The inventory filters support product name, barcode, category, and brand
search; category and stock status selection; and an expiry-date range.
Product details include every stored product field. Product images are stored
as optional HTTP/HTTPS URLs.

## Phase 3 stock receiving

Owner and Staff can enter or scan a barcode, find an existing product or
create a new one, record a receipt, and see recent receiving history. Stock
updates and history insertion are committed together in PostgreSQL.

## Phase 4 Smart Product Locator

Owner and Staff can search products by name, barcode, category, or brand;
filter by rack or shelf; assign or move a product location; view the optional
location photo URL; and inspect location history. Location updates and their
history records are transaction-safe. Photos use public HTTP/HTTPS URLs because
no Supabase Storage buckets are configured in this project.

Apply all numbered database migrations with `npm --prefix backend run db:migrate`.

## Phase 5 Quick Sale

Owner and Staff can look up existing products by barcode, or search by name,
barcode, category, and brand; add products to a cart; choose CASH, UPI, or
CARD; and complete a sale. Product creation is not available in Quick Sale.
The backend fetches prices from PostgreSQL, calculates amounts in exact cents,
locks product rows, and atomically writes the sale/items and deducts stock.
Every sale records the authenticated user and database timestamp, and items
retain their sale-time unit price and subtotal. Owner can view sale history
and details; Staff can sell and view the receipt for the sale they submit.

Sales APIs:

- `GET /api/sales/product/:barcode` — barcode lookup.
- `GET /api/sales/products?search=...` — name/barcode/category/brand fallback.
- `GET /api/sales/products/:productId` — refresh a product by ID.
- `POST /api/sales` — transaction-safe checkout; body contains `items`
  (`product_id`, `quantity`) and `payment_method` (`CASH`, `UPI`, or `CARD`).
- `GET /api/sales/history?limit=50` — Owner-only sale history.
- `GET /api/sales/:saleId` — Owner-only sale details.

## Phase 6 expiry and low-stock alerts

Expiry and stock statuses are calculated from the existing PostgreSQL product
fields; no additional table or migration is required. Date comparisons use
PostgreSQL `CURRENT_DATE` (the database session's configured timezone), not
the browser's local clock.

- An expiry date on or before today is `EXPIRED`; `days_to_expiry` is still
  zero on the expiry date and negative for earlier dates.
- Dates 1–7 days ahead are `EXPIRING_SOON_7_DAYS`; dates 8–30 days ahead are
  `EXPIRING_30_DAYS`; dates more than 30 days ahead are `SAFE`.
- A NULL expiry date is `NO_EXPIRY_DATE`, with `days_to_expiry: null`.
- Stock status remains compatible with Phase 2: zero is `Out of Stock`,
  positive stock at or below minimum is `Low Stock`, and stock above minimum
  is `In Stock`. Expiry does not override stock status.
- The Owner Expiry page shows live alert counts and matching product lists.
  Earliest-expiring items are listed first in expiry filters with a FEFO-style
  suggestion; inventory remains tracked per product, not per batch.
- Quick Sale warns when a product is expired (and when it expires within
  seven days). An explicit checkbox confirmation is required before an expired
  product can be added to the cart; the existing backend sale policy is not
  changed.

Authenticated Owner APIs:

- `GET /api/products/alerts` — live counts for expired, 1–7 day expiry,
  8–30 day expiry, low-stock, and out-of-stock products, plus the database's
  `as_of_date`.
- `GET /api/products?expiryStatus=expired|expiring-7-days|expiring-30-days|safe|no-expiry-date`
  — filter inventory by derived expiry status.
- Existing stock-status, search, category, and expiry-date range filters
  continue to work and can be combined with `expiryStatus`.

## Phase 7 stock audit

Stock Audit compares an Owner-entered physical count with
`products.current_stock` at the instant the audit is created. The backend locks
the product row, takes its current stock as expected stock, and calculates
`difference` as `physical_stock - expected_stock`. A zero difference is
`MATCHED`, a negative difference is `UNACCOUNTED_STOCK`, and a positive
difference is `OVERAGE`. These neutral statuses do not assign blame or prove a
cause. Optional reasons are investigation labels, not established findings.

`public.stock_audits` stores the immutable expected/physical snapshot, derived
difference/status, optional reason and notes, user, and audit time. Auditing
never updates `products.current_stock`; explicit stock reconciliation is not
implemented. Audited products cannot be deleted so their audit
history can be retained; product deletion responds with HTTP 409.

All audit endpoints are authenticated and Owner-only:

- `POST /api/stock-audits` — accepts `product_id`, non-negative integer
  `physical_stock`, and optional `reason` and `notes`. The backend assigns
  expected stock, difference, status, user, and timestamp.
- `GET /api/stock-audits` — history with optional `search` (product name or
  barcode), `status`, `reason`, `auditedBy`, `dateFrom`, `dateTo`, and `limit`.
- `GET /api/stock-audits/:auditId` — audit detail with product status and
  current location, when assigned.
- `GET /api/stock-audits/summary` — counts and unaccounted/overage quantities
  calculated from audit records.

The Stock Audit page provides product/barcode lookup, current-stock/location
context, count preview, optional reason/notes, database-backed summaries,
history filters, and immutable audit details. Staff cannot use Owner audit
routes. Run the backend tests with `npm --prefix backend test` and the
production frontend build with `npm --prefix frontend run build`.

## Phase 8 payment reconciliation

Phase 5 `public.sales` is the source of truth: each committed row is a completed
sale with `total_amount numeric(22,2)`, `payment_method` (`CASH`, `UPI`, or
`CARD`), `sold_by` (a foreign key to `users.id`), and `sold_at`. Sale creation
is atomic with sale items and stock deduction, so reconciliation sums
`sales.total_amount` by payment method and selected date period; it does not
recalculate or duplicate sale data.

The Owner-only Payments page compares that expected amount with entered actual
collection. Amounts are parsed and differenced in integer cents on the backend.
`public.payment_reconciliations` records three immutable method snapshots for
each date period. A unique period/method constraint and one database
transaction prevent partial or concurrent duplicate reconciliations. Statuses
are `PAYMENT_MATCHED`, `SHORT_COLLECTION`, and `EXCESS_COLLECTION`; a
discrepancy is neutral and requires review, not an automatic attribution.
Reconciliation does not update sales, sale items, payment methods, or stock.

APIs (all authenticated and Owner-only):

- `GET /api/payment-reconciliation/summary?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD`
  — selected-period total recorded sales and expected collection, saved actual
  totals when available, and Cash/UPI/Card breakdown.
- `GET /api/payment-reconciliation/staff-summary?dateFrom=...&dateTo=...`
  — real Staff sales totals/counts; optional `staffId` and `paymentMethod`.
- `GET /api/payment-reconciliation/history` — history with optional date,
  payment-method, status, and reconciled-by filters.
- `GET /api/payment-reconciliation/:reconciliationId` — one saved comparison.
- `POST /api/payment-reconciliation` — records actual amounts for all three
  methods for `period_start`, `period_end`; optional `reason` and `notes`.
  Expected values and statuses are calculated on the server.

## Phase 9 Staff Activity and audit trail

The existing relationships use `users.id` for the authenticated actor,
`products.product_id` for related inventory, `receiving_history.receiving_id`
for receipts, `location_history.history_id` for location changes,
`sales.sale_id` for sales, `stock_audits.audit_id` for stock counts, and
`payment_reconciliations.reconciliation_id` for payment comparisons. Activity
rows are written by backend business handlers, not by client-selected action
names. Each multi-item sale is represented by one `SALE` activity per product
line, linked to its shared sale ID.

`public.staff_activities` retains the actor (`ON DELETE RESTRICT`) and sets a
deleted product reference to NULL while preserving the product name/barcode
snapshot in metadata. Database triggers reject updates and deletes. The Owner
Staff Activity page offers server-side filtering, pagination, details, and a
neutral per-Staff action summary. No passwords, hashes, sessions, or tokens
are logged. The immutability trigger permits only the product foreign-key
`ON DELETE SET NULL` update when every other activity field remains unchanged;
this preserves history without preventing deletion of otherwise-unreferenced
products.

Authenticated Owner APIs:

- `GET /api/staff-activities` — paginated history (`page`, `limit`) with
  optional `userId`, `actionType`, `productSearch`, `dateFrom`, `dateTo`,
  `referenceType`, and `referenceId`.
- `GET /api/staff-activities/:activityId` — one immutable activity detail.
- `GET /api/staff-activities/summary` — per-Staff activity counts with optional
  date range.

Run backend validation and regression tests with
`npm --prefix backend test`, and build the frontend with
`npm --prefix frontend run build`.

## Phase 10 Owner Dashboard

The Owner-only dashboard uses `GET /api/dashboard` to aggregate current
products, sales, expiry dates, latest per-product stock audits, payment
reconciliations, and the existing Staff activity trail. It creates no
additional business records. Sales/revenue covers the database's current day;
the chart covers the latest seven days, top sellers cover 30 days, and the
recent activity list contains the latest Staff actions.

Profit uses the sale-item selling-price and purchase-price snapshots captured
at checkout. Sale items created before the cost-snapshot migration retain a
NULL purchase-price snapshot; they are excluded from profit totals and the
dashboard identifies how many such historical sale items exist. Stock
mismatch counts products whose latest audit is not `MATCHED`; payment mismatch
counts stored reconciliation rows whose status is not `PAYMENT_MATCHED`.

## Phase 11 Reports & Analytics

The Owner-only Reports page uses the read-only `GET /api/reports` endpoint.
Date-range presets and custom dates filter existing sales, sale-item profit,
receiving records, and stock audits; current inventory valuation remains based
on present product stock and purchase price. Top sellers can be limited to 5
or 10 products. Profit uses the checkout-time selling and purchase-price
snapshots; sale items without a historical purchase snapshot are excluded and
reported as unavailable rather than estimated. No report tables or duplicate
business records are created.

## Phase 12 AI Smart Assistant

The Owner-only AI Assistant accepts a question through
`POST /api/ai-assistant` with `{"question":"..."}`. It first reads summarized
current facts from existing products, sales, sale-item snapshots, stock audits,
and payment reconciliations, then sends only those facts and the question to
the configured OpenAI-compatible chat-completions API. Profit uses
`sale_items.purchase_price_snapshot`; missing historical costs remain
unavailable. Low-stock and expiry status use the shared Phase 6 status logic.
Top sellers and slow-moving products are limited to the last 30 calendar days.

Configure `AI_API_KEY`, `AI_PROVIDER` (`openai` or `openai-compatible`),
`AI_MODEL`, and optionally `AI_BASE_URL` in the backend environment. If the
key is absent, the endpoint returns a clear configuration response. The
provider has no tools or database connection and cannot modify SmartStock
records. Questions are limited to 500 characters; chats are kept only in the
current browser page and are not stored in the database.

Dashboard access requires an authenticated Owner session. Staff are denied by
the backend; unauthenticated requests receive HTTP 401. Empty chart, list, and
alert states are shown without demo values.

## Phase 11 Reports & Analytics

The Owner-only Reports page uses the read-only `GET /api/reports` endpoint.
Date-range presets and custom dates filter existing sales, sale-item profit,
receiving records, and stock audits; current inventory valuation remains based
on present product stock and purchase price. Top sellers can be limited to 5
or 10 products. Profit uses the checkout-time selling and purchase-price
snapshots; sale items without a historical purchase snapshot are excluded and
reported as unavailable rather than estimated. No report tables or duplicate
business records are created.

## Start the backend

In one terminal, from the project root:

```sh
npm --prefix backend run dev
```

## Start the frontend

In another terminal, from the project root:

```sh
npm --prefix frontend run dev
```

Open the local URL printed by Vite (normally `http://localhost:5173`). Vite
proxies `/api` requests to the backend on port `3001`; the backend also enables
CORS for the configured frontend origin.

## Test the health API

```sh
curl -i http://localhost:3001/api/health
```

With a working Supabase connection, the API returns HTTP `200`:

```json
{
  "success": true,
  "message": "SmartStock Backend Connected",
  "database": "connected"
}
```

If the database URL is missing or the database query fails, it returns HTTP
`503` with `"database": "disconnected"`. The frontend displays both backend
and database status from this response.
