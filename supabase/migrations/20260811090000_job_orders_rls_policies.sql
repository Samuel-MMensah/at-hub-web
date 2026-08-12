-- job_orders RLS — the security-review fix (Option A: role allowlists).
-- Back-captured migration (see README.md) — applied to production 2026-08-11.
-- Timestamp: date real; time synthetic (ordering only).
-- Source: VERBATIM — this exact script was run in the Supabase SQL editor this
-- session (see MIGRATION_STATUS.md, "Security hardening pass").
-- Depends on: current_user_role() (20260803100000), job_orders (baseline).
--
-- Closes a confirmed live exposure (a Guest session could read/insert/update
-- job_orders). SELECT stays open to any authenticated user by design. This drops
-- ALL pre-existing job_orders policies first so the end state is fully known —
-- note that on the live DB those dropped policies predate this migration folder
-- and are not captured here (see README.md, "baseline predates tracking").

BEGIN;

ALTER TABLE public.job_orders ENABLE ROW LEVEL SECURITY;

-- Drop every existing policy on job_orders (whatever their names) so the end
-- state is deterministic — nothing permissive lingers behind.
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'job_orders'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.job_orders', pol.policyname);
  END LOOP;
END $$;

-- SELECT: unchanged behavior — any authenticated user reads company-wide.
CREATE POLICY job_orders_select ON public.job_orders
  FOR SELECT TO authenticated
  USING (true);

-- INSERT: only order-raising roles (+ admins). Excludes Guest.
CREATE POLICY job_orders_insert ON public.job_orders
  FOR INSERT TO authenticated
  WITH CHECK (lower(current_user_role()) IN
    ('admin','manager','supervisor','md','fm','front desk','operations'));

-- UPDATE: union of every real writer role. Excludes Guest.
CREATE POLICY job_orders_update ON public.job_orders
  FOR UPDATE TO authenticated
  USING (lower(current_user_role()) IN
    ('admin','manager','supervisor','md','fm','finance','warehouse','scheduler',
     'front desk','operations','production_press','production_garment'))
  WITH CHECK (lower(current_user_role()) IN
    ('admin','manager','supervisor','md','fm','finance','warehouse','scheduler',
     'front desk','operations','production_press','production_garment'));

-- DELETE: admins only.
CREATE POLICY job_orders_delete ON public.job_orders
  FOR DELETE TO authenticated
  USING (lower(current_user_role()) IN
    ('admin','manager','supervisor','md','fm'));

COMMIT;
