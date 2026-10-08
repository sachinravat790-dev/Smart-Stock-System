BEGIN;

ALTER TABLE public.sale_items
  ADD COLUMN IF NOT EXISTS purchase_price_snapshot numeric(12, 2)
  CHECK (
    purchase_price_snapshot IS NULL OR purchase_price_snapshot >= 0
  );

COMMENT ON COLUMN public.sale_items.purchase_price_snapshot IS
  'Product purchase price captured when the sale item was created; NULL for sales predating this snapshot.';

COMMIT;
