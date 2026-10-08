BEGIN;

CREATE TABLE IF NOT EXISTS public.staff_activities (
  activity_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  action_type text NOT NULL CHECK (
    action_type IN (
      'LOGIN',
      'LOGOUT',
      'RECEIVE_STOCK',
      'ADD_PRODUCT',
      'UPDATE_PRODUCT',
      'MOVE_PRODUCT',
      'SALE',
      'STOCK_AUDIT',
      'PAYMENT_RECONCILIATION'
    )
  ),
  product_id uuid REFERENCES public.products(product_id) ON DELETE SET NULL,
  quantity integer,
  reference_type text CHECK (
    reference_type IS NULL OR char_length(reference_type) BETWEEN 1 AND 80
  ),
  reference_id text CHECK (
    reference_id IS NULL OR char_length(reference_id) BETWEEN 1 AND 160
  ),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(metadata) = 'object' AND pg_column_size(metadata) <= 8192
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_activities_quantity_check CHECK (
    quantity IS NULL OR quantity BETWEEN -2147483648 AND 2147483647
  )
);

CREATE INDEX IF NOT EXISTS staff_activities_created_at_idx
  ON public.staff_activities (created_at DESC, activity_id DESC);

CREATE INDEX IF NOT EXISTS staff_activities_user_created_at_idx
  ON public.staff_activities (user_id, created_at DESC, activity_id DESC);

CREATE INDEX IF NOT EXISTS staff_activities_action_created_at_idx
  ON public.staff_activities (action_type, created_at DESC);

CREATE INDEX IF NOT EXISTS staff_activities_product_created_at_idx
  ON public.staff_activities (product_id, created_at DESC)
  WHERE product_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS staff_activities_reference_idx
  ON public.staff_activities (reference_type, reference_id)
  WHERE reference_type IS NOT NULL AND reference_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.smartstock_prevent_staff_activity_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.product_id IS NOT NULL
     AND NEW.product_id IS NULL
     AND (to_jsonb(NEW) - 'product_id') = (to_jsonb(OLD) - 'product_id') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Staff activity records are immutable'
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS smartstock_staff_activities_immutable
  ON public.staff_activities;
CREATE TRIGGER smartstock_staff_activities_immutable
  BEFORE UPDATE OR DELETE ON public.staff_activities
  FOR EACH ROW
  EXECUTE FUNCTION public.smartstock_prevent_staff_activity_mutation();

ALTER TABLE public.staff_activities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_activities FROM anon, authenticated;

COMMIT;
