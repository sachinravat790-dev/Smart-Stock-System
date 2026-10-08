BEGIN;

CREATE TABLE IF NOT EXISTS public.stock_audits (
  audit_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(product_id) ON DELETE RESTRICT,
  expected_stock integer NOT NULL CHECK (expected_stock >= 0),
  physical_stock integer NOT NULL CHECK (physical_stock >= 0),
  difference integer NOT NULL,
  reason text CHECK (
    reason IS NULL OR reason IN (
      'UNRECORDED_SALE',
      'DAMAGE',
      'RETURN',
      'COUNTING_ERROR',
      'MISSING_STOCK',
      'OTHER'
    )
  ),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 1000),
  audited_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  audited_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL,
  CONSTRAINT stock_audits_difference_check CHECK (
    difference = physical_stock - expected_stock
  ),
  CONSTRAINT stock_audits_status_check CHECK (
    status IN ('MATCHED', 'UNACCOUNTED_STOCK', 'OVERAGE')
    AND (
    (difference = 0 AND status = 'MATCHED')
    OR (difference < 0 AND status = 'UNACCOUNTED_STOCK')
    OR (difference > 0 AND status = 'OVERAGE')
    )
  )
);

CREATE INDEX IF NOT EXISTS stock_audits_audited_at_idx
  ON public.stock_audits (audited_at DESC);

CREATE INDEX IF NOT EXISTS stock_audits_product_audited_at_idx
  ON public.stock_audits (product_id, audited_at DESC);

CREATE INDEX IF NOT EXISTS stock_audits_status_audited_at_idx
  ON public.stock_audits (status, audited_at DESC);

CREATE INDEX IF NOT EXISTS stock_audits_audited_by_audited_at_idx
  ON public.stock_audits (audited_by, audited_at DESC);

ALTER TABLE public.stock_audits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stock_audits FROM anon, authenticated;

COMMIT;
