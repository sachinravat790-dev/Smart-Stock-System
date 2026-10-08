BEGIN;

CREATE TABLE IF NOT EXISTS public.sales (
  sale_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sold_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  total_amount numeric(22, 2) NOT NULL CHECK (total_amount >= 0),
  payment_method text NOT NULL CHECK (payment_method IN ('CASH', 'UPI', 'CARD')),
  sold_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sale_items (
  sale_item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES public.sales(sale_id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(product_id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price numeric(12, 2) NOT NULL CHECK (unit_price >= 0),
  subtotal numeric(22, 2) NOT NULL CHECK (subtotal >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sales_sold_at_idx
  ON public.sales (sold_at DESC);

CREATE INDEX IF NOT EXISTS sales_sold_by_sold_at_idx
  ON public.sales (sold_by, sold_at DESC);

CREATE INDEX IF NOT EXISTS sale_items_sale_id_idx
  ON public.sale_items (sale_id);

CREATE INDEX IF NOT EXISTS sale_items_product_id_idx
  ON public.sale_items (product_id);

ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sales FROM anon, authenticated;
ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sale_items FROM anon, authenticated;

COMMIT;
