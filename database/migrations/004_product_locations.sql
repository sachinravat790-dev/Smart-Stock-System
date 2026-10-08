BEGIN;

CREATE TABLE IF NOT EXISTS public.product_locations (
  location_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(product_id) ON DELETE CASCADE,
  rack_code text NOT NULL CHECK (
    char_length(trim(rack_code)) BETWEEN 1 AND 80
    AND rack_code = trim(rack_code)
    AND rack_code !~ '[[:cntrl:]]'
  ),
  shelf_code text NOT NULL CHECK (
    char_length(trim(shelf_code)) BETWEEN 1 AND 80
    AND shelf_code = trim(shelf_code)
    AND shelf_code !~ '[[:cntrl:]]'
  ),
  location_photo text CHECK (
    location_photo IS NULL OR (
      char_length(location_photo) <= 2048
      AND location_photo ~* '^https?://[^[:space:]]+$'
    )
  ),
  is_current boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS product_locations_one_current_idx
  ON public.product_locations (product_id)
  WHERE is_current;

CREATE INDEX IF NOT EXISTS product_locations_rack_shelf_idx
  ON public.product_locations (rack_code, shelf_code)
  WHERE is_current;

DROP TRIGGER IF EXISTS smartstock_product_locations_updated_at
  ON public.product_locations;
CREATE TRIGGER smartstock_product_locations_updated_at
  BEFORE UPDATE ON public.product_locations
  FOR EACH ROW
  EXECUTE FUNCTION public.smartstock_set_user_updated_at();

CREATE TABLE IF NOT EXISTS public.location_history (
  history_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(product_id) ON DELETE CASCADE,
  previous_rack_code text,
  previous_shelf_code text,
  new_rack_code text NOT NULL CHECK (
    char_length(trim(new_rack_code)) BETWEEN 1 AND 80
    AND new_rack_code = trim(new_rack_code)
    AND new_rack_code !~ '[[:cntrl:]]'
  ),
  new_shelf_code text NOT NULL CHECK (
    char_length(trim(new_shelf_code)) BETWEEN 1 AND 80
    AND new_shelf_code = trim(new_shelf_code)
    AND new_shelf_code !~ '[[:cntrl:]]'
  ),
  changed_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  changed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT location_history_previous_codes_check CHECK (
    (previous_rack_code IS NULL AND previous_shelf_code IS NULL)
    OR (
      previous_rack_code IS NOT NULL
      AND previous_shelf_code IS NOT NULL
      AND char_length(trim(previous_rack_code)) BETWEEN 1 AND 80
      AND previous_rack_code = trim(previous_rack_code)
      AND previous_rack_code !~ '[[:cntrl:]]'
      AND char_length(trim(previous_shelf_code)) BETWEEN 1 AND 80
      AND previous_shelf_code = trim(previous_shelf_code)
      AND previous_shelf_code !~ '[[:cntrl:]]'
    )
  )
);

CREATE INDEX IF NOT EXISTS location_history_product_changed_at_idx
  ON public.location_history (product_id, changed_at DESC);

ALTER TABLE public.product_locations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.product_locations FROM anon, authenticated;
ALTER TABLE public.location_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.location_history FROM anon, authenticated;

COMMIT;
