# Database

SmartStock uses the existing Supabase PostgreSQL database configured with
`SUPABASE_DB_URL`.

Apply all ordered schema migrations from the project root with:

```sh
npm --prefix backend run db:migrate
```

Phase 1 creates `public.users` for Owner and Staff credentials and stores
bcrypt password hashes only. PostgreSQL-backed browser sessions are stored in
`public.smartstock_sessions`, which is created by the schema migration and
used by the session store.

Phase 2 creates `public.products` for real product and inventory records.
Product access is through Owner-authorized backend endpoints.

Phase 3 creates `public.receiving_history` to record stock receipts.

Phase 4 creates `public.product_locations` for current and previous product
locations, and `public.location_history` for location changes. Location
assignment and history are written together in a PostgreSQL transaction.
Both tables reference the existing `products.product_id` and `users.id`
columns. Owner and Staff access locations through authenticated backend APIs.
No Supabase Storage buckets are configured, so location photos are optional
HTTP/HTTPS URLs.

Phase 5 creates `public.sales` and `public.sale_items`. Sales reference the
authenticated user, and sale items reference the existing product IDs. The
backend saves the sale, item price snapshots, and stock deductions in one
transaction after locking product rows. Payment methods are constrained to
CASH, UPI, or CARD. For Phase 8 reconciliation, `sales.total_amount` is the
recorded completed-sale total, `payment_method` is its method, `sold_by`
references `users.id`, and `sold_at` is the sale time; these existing values
are the sole source for expected collections.

Phase 6 uses the existing `products.expiry_date`, `current_stock`, and
`minimum_stock` fields; it requires no schema migration. PostgreSQL derives
expiry status and days-to-expiry against `CURRENT_DATE` and calculates stock
status from current and minimum stock. The existing partial expiry-date index
is reused for expiry filters.

Phase 7 adds `public.stock_audits`, with foreign keys to `products.product_id`
and `users.id`, non-negative stock constraints, difference/status consistency
checks, allowed reason/status values, and indexes for audit time, product,
status, and auditor. The Owner-only API snapshots `products.current_stock`
while locking the product row and stores an immutable comparison; it does not
change stock. Inventory stock reconciliation is not implemented.

Phase 8 adds `public.payment_reconciliations`, with one immutable row per
period and method (CASH, UPI, or CARD). Rows store the database-calculated
expected amount, Owner-entered actual amount, exact difference, neutral status,
optional reason/notes, and `reconciled_by` reference to `users.id`. Checks
enforce non-negative money, valid date periods, and difference/status
consistency. A unique period/method constraint prevents duplicates, including
concurrent requests; all three payment methods are inserted in one transaction.
Indexes support period, method, status, and reconciler history queries. The
table is accessible through Owner-authorized backend routes only.

Phase 9 adds `public.staff_activities`. `user_id` references `users.id` with
`ON DELETE RESTRICT`; nullable `product_id` references `products.product_id`
with `ON DELETE SET NULL`, while product name/barcode are retained in bounded
JSONB metadata. The immutability trigger permits only that foreign-key
nullification when all other activity fields are unchanged; other updates and
all deletes are rejected. Controlled action names, integer quantity bounds,
metadata shape/size, and RLS/revokes are enforced.
Indexes support newest-first history, user/date and action/date filtering,
product references, and original transaction references. The backend writes
activity inside the same PostgreSQL transaction as product, receiving,
location, sale, stock-audit, and payment-reconciliation operations. Successful
login/logout are recorded with only the existing user ID and action type.
Owner-only reads are served by the backend; there is no activity-create API.

Phase 10 adds no database tables. The Owner Dashboard aggregates existing
products, sales/sale items, audits, payment reconciliations, and staff
activities through a read-only backend endpoint. Today's sales use
`sales.sold_at`; profit combines the sale-item `unit_price` and
`purchase_price_snapshot` recorded at checkout. Phase 10's migration adds a
nullable `sale_items.purchase_price_snapshot` for existing sale rows; no
historical purchase costs are backfilled or estimated, and rows with a NULL
snapshot are excluded from profit and counted as unavailable.

Phase 11 adds no database tables or migrations. The Owner-only Reports API
aggregates the same source records with parameterized date-range filters:
sales and sale items, current products, receiving history, and stock audits.

Phase 12 also adds no database tables or migrations. The Owner-only AI
Assistant reads summarized facts from the existing products, sales,
sale-item snapshot, stock-audit, and payment-reconciliation tables. The model
provider receives no database access and has no write tools.

Create real accounts interactively with:

```sh
npm --prefix backend run user:create
```

The password and confirmation are entered without terminal echo. This command
does not print account email addresses or passwords.

To reset the single Staff account's password hash without changing its email,
name, or role, run `npm --prefix backend run user:reset-staff`. Its password
input is also hidden and the operation fails unless exactly one Staff account
exists.
