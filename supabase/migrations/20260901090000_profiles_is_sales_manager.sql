-- profiles.is_sales_manager flag + current_user_is_sales_manager() +
-- an additive SELECT policy letting a flagged manager read every sales-
-- rep-attributed job_invoices row, not just their own name's.
--
-- NEW migration (not back-captured) — per the "Going forward" rule in
-- supabase/migrations/README.md, this file is written and the identical
-- statements are applied in the Supabase SQL editor together, in the
-- same change.
--
-- Depends on: profiles.is_sales_rep (20260804110000), current_user_is_
--             sales_rep() + current_user_full_name() (20260804113000),
--             job_invoices + job_orders.sales_rep (20260804090000 /
--             20260804103000), job_orders RLS (20260811090000).
--
-- is_sales_manager is orthogonal to role AND orthogonal to is_sales_rep —
-- Isaac Kum and Charles Adoo will hold BOTH flags at once (a sales rep
-- who also manages other reps' visibility), the same kind of independence
-- already established for is_sales_rep itself.
--
-- job_orders gets NO additive policy here, deliberately: job_orders_select
-- (20260811090000_job_orders_rls_policies.sql) is already `USING (true)`
-- for every authenticated user, so a manager (like everyone else) already
-- reads every job_orders row regardless of sales_rep — a new policy
-- scoped to `sales_rep IS NOT NULL` would be a strict subset of what's
-- already granted, i.e. a genuine no-op. Re-read that migration's own
-- text to confirm this before writing this one, not assumed — and this
-- is exactly the same reasoning the Phase 4a migration
-- (20260804113000_sales_rep_dashboard_access.sql) already used to skip a
-- job_orders policy for the sales-rep-own-data case.

ALTER TABLE profiles ADD COLUMN is_sales_manager BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION current_user_is_sales_manager()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT COALESCE(is_sales_manager, false) FROM profiles WHERE id = auth.uid()
$$;

-- ADDITIVE — OR'd with "finance and admin can read invoices" (role-based)
-- and "sales rep can view own attributed job invoices" (own-name-only).
-- Same two-branch shape as the rep's own policy (the invoice's own
-- sales_rep field, OR via its linked job_order's sales_rep), just without
-- the name match — any invoice/linked-order attributed to ANY rep, not
-- just this manager's own name.
CREATE POLICY "sales manager can view all rep-attributed job invoices"
ON job_invoices AS PERMISSIVE FOR SELECT TO authenticated
USING (
  current_user_is_sales_manager()
  AND (
    sales_rep IS NOT NULL
    OR job_order_no IN (
      SELECT job_order_no FROM job_orders WHERE sales_rep IS NOT NULL
    )
  )
);
