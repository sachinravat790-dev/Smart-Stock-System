BEGIN;

CREATE TABLE IF NOT EXISTS public.products (
  product_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_name text NOT NULL CHECK (
    char_length(trim(product_name)) BETWEEN 1 AND 160
  ),
  barcode text CHECK (
    barcode IS NULL OR (
      char_length(barcode) BETWEEN 1 AND 128
      AND barcode = trim(barcode)
      AND barcode !~ '[[:cntrl:]]'
    )
  ),
  category text CHECK (
    category IS NULL OR char_length(trim(category)) BETWEEN 1 AND 100
  ),
  brand text CHECK (
    brand IS NULL OR char_length(trim(brand)) BETWEEN 1 AND 100
  ),
  purchase_price numeric(12, 2) NOT NULL DEFAULT 0 CHECK (purchase_price >= 0),
  selling_price numeric(12, 2) NOT NULL CHECK (selling_price >= 0),
  current_stock integer NOT NULL DEFAULT 0 CHECK (current_stock >= 0),
  minimum_stock integer NOT NULL DEFAULT 0 CHECK (minimum_stock >= 0),
  expiry_date date,
  product_image text CHECK (
    product_image IS NULL OR (
      char_length(product_image) <= 2048
      AND product_image ~* '^https?://'
    )
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS products_barcode_unique
  ON public.products (barcode)
  WHERE barcode IS NOT NULL;

CREATE INDEX IF NOT EXISTS products_name_search_idx
  ON public.products (lower(product_name));

CREATE INDEX IF NOT EXISTS products_category_idx
  ON public.products (category);

CREATE INDEX IF NOT EXISTS products_expiry_date_idx
  ON public.products (expiry_date)
  WHERE expiry_date IS NOT NULL;

DROP TRIGGER IF EXISTS smartstock_products_updated_at ON public.products;
CREATE TRIGGER smartstock_products_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.smartstock_set_user_updated_at();

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.products FROM anon, authenticated;

COMMIT;
