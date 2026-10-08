BEGIN;

CREATE TABLE IF NOT EXISTS public.receiving_history (
  receiving_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(product_id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity > 0),
  purchase_price numeric(12, 2) NOT NULL CHECK (purchase_price >= 0),
  supplier text CHECK (
    supplier IS NULL OR (
      char_length(trim(supplier)) BETWEEN 1 AND 160
      AND supplier !~ '[[:cntrl:]]'
    )
  ),
  received_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS receiving_history_received_at_idx
  ON public.receiving_history (received_at DESC);

CREATE INDEX IF NOT EXISTS receiving_history_product_id_idx
  ON public.receiving_history (product_id, received_at DESC);

ALTER TABLE public.receiving_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.receiving_history FROM anon, authenticated;

COMMIT;
