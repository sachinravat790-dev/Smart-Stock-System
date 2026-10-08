BEGIN;

CREATE TABLE IF NOT EXISTS public.payment_reconciliations (
  reconciliation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start date NOT NULL,
  period_end date NOT NULL,
  payment_method text NOT NULL CHECK (payment_method IN ('CASH', 'UPI', 'CARD')),
  expected_amount numeric(22, 2) NOT NULL CHECK (expected_amount >= 0),
  actual_amount numeric(22, 2) NOT NULL CHECK (actual_amount >= 0),
  difference numeric(23, 2) NOT NULL,
  status text NOT NULL,
  reason text CHECK (reason IS NULL OR char_length(reason) <= 200),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 1000),
  reconciled_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  reconciled_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_reconciliations_period_check CHECK (period_end >= period_start),
  CONSTRAINT payment_reconciliations_difference_check CHECK (
    difference = actual_amount - expected_amount
  ),
  CONSTRAINT payment_reconciliations_status_check CHECK (
    status IN ('PAYMENT_MATCHED', 'SHORT_COLLECTION', 'EXCESS_COLLECTION')
    AND (
    (difference = 0 AND status = 'PAYMENT_MATCHED')
    OR (difference < 0 AND status = 'SHORT_COLLECTION')
    OR (difference > 0 AND status = 'EXCESS_COLLECTION')
    )
  ),
  CONSTRAINT payment_reconciliations_period_method_unique
    UNIQUE (period_start, period_end, payment_method)
);

CREATE INDEX IF NOT EXISTS payment_reconciliations_period_idx
  ON public.payment_reconciliations (period_start DESC, period_end DESC);

CREATE INDEX IF NOT EXISTS payment_reconciliations_method_period_idx
  ON public.payment_reconciliations (payment_method, period_start DESC);

CREATE INDEX IF NOT EXISTS payment_reconciliations_status_period_idx
  ON public.payment_reconciliations (status, period_start DESC);

CREATE INDEX IF NOT EXISTS payment_reconciliations_reconciled_by_idx
  ON public.payment_reconciliations (reconciled_by, reconciled_at DESC);

ALTER TABLE public.payment_reconciliations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_reconciliations FROM anon, authenticated;

COMMIT;
