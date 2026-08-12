-- job_invoices: schema + RLS (Invoice Entry, Phase 3).
-- Back-captured migration (see README.md) — applied to production 2026-08-04.
-- Timestamp: date real; time synthetic (ordering only).
-- Source: verbatim from the build session transcript.
-- Depends on: current_user_role() (20260803100000), job_orders (baseline).

CREATE TABLE job_invoices (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_order_no TEXT REFERENCES job_orders(job_order_no),
  date DATE NOT NULL,
  customer_name TEXT,
  product_description TEXT,
  revenue_category TEXT NOT NULL CHECK (revenue_category IN (
    'Large Format', 'Screen Print', 'Embroidery', 'Digital Press',
    'Commercial Press', 'Publishing', 'Packaging'
  )),
  business_unit TEXT NOT NULL CHECK (business_unit IN (
    'WALK-IN', 'PRIVATE', 'GOVERNMENT', 'SUBSIDIARY'
  )),
  quantity NUMERIC NOT NULL,
  unit_price NUMERIC NOT NULL,
  amount NUMERIC NOT NULL,
  nhil NUMERIC NOT NULL DEFAULT 0,
  vat NUMERIC NOT NULL DEFAULT 0,
  invoice_total NUMERIC NOT NULL,
  payment NUMERIC NOT NULL DEFAULT 0,
  balance NUMERIC NOT NULL,
  status TEXT CHECK (status IS NULL OR status IN ('DELIVERED', 'IN PRODUCTION')),
  oracle_no TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE job_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "finance and admin can read invoices"
ON job_invoices FOR SELECT TO authenticated
USING (lower(current_user_role()) IN ('admin','manager','supervisor','md','fm','finance'));

CREATE POLICY "finance and admin can insert invoices"
ON job_invoices FOR INSERT TO authenticated
WITH CHECK (lower(current_user_role()) IN ('admin','manager','supervisor','md','fm','finance'));

CREATE POLICY "finance and admin can update invoices"
ON job_invoices FOR UPDATE TO authenticated
USING (lower(current_user_role()) IN ('admin','manager','supervisor','md','fm','finance'))
WITH CHECK (lower(current_user_role()) IN ('admin','manager','supervisor','md','fm','finance'));
