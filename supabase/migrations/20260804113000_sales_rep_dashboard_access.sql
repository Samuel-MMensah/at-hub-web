-- Sales Rep Dashboard access foundation (Phase 4a): identity helpers +
-- a permissive SELECT policy letting a sales rep see their own attributed invoices.
-- Back-captured migration (see README.md) — applied to production 2026-08-04.
-- Timestamp: date real; time synthetic (ordering only).
-- Source: verbatim from the build session transcript.
-- Depends on: profiles.is_sales_rep (20260804110000), job_invoices + its
--             sales_rep/job_order_no columns (20260804090000 / 20260804103000).
--
-- Only ONE policy was added, on job_invoices: job_orders SELECT was already open
-- to any authenticated user, so no sales-rep job_orders policy was needed.
-- This permissive policy is OR'd with the existing "finance and admin can read
-- invoices" policy.

CREATE OR REPLACE FUNCTION current_user_full_name()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT full_name FROM profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION current_user_is_sales_rep()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT COALESCE(is_sales_rep, false) FROM profiles WHERE id = auth.uid()
$$;

CREATE POLICY "sales rep can view own attributed job invoices"
ON job_invoices AS PERMISSIVE FOR SELECT TO authenticated
USING (
  current_user_is_sales_rep()
  AND (
    sales_rep = current_user_full_name()
    OR job_order_no IN (
      SELECT job_order_no FROM job_orders WHERE sales_rep = current_user_full_name()
    )
  )
);
