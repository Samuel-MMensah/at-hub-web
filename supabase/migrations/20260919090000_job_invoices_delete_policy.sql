-- job_invoices DELETE RLS policy — same role allowlist as its own
-- UPDATE policy ("finance and admin can update invoices",
-- 20260804090000_job_invoices.sql), same pattern as job_orders' own
-- DELETE policy (job_orders_delete, 20260811090000_job_orders_rls_
-- policies.sql).
--
-- NEW migration (not back-captured) — per the "Going forward" rule in
-- supabase/migrations/README.md, this file is written and the identical
-- statement is applied in the Supabase SQL editor together, in the same
-- change.
--
-- Depends on: current_user_role() (20260803100000), job_invoices
--             (20260804090000).
--
-- This is the ONLY new RLS surface this feature needs. The app's own
-- deleteInvoice Server Action additionally hard-blocks any invoice with
-- payment > 0 (see actions.ts) — that check is NOT duplicated here as a
-- second USING clause, since RLS is deliberately kept as the role gate
-- only, matching how job_orders_delete doesn't attempt to encode
-- deleteMasterOrder's own confirm-text check either. Two independent
-- layers, two independent jobs: RLS says WHO, the action says WHEN.

CREATE POLICY "finance and admin can delete invoices"
ON job_invoices FOR DELETE TO authenticated
USING (lower(current_user_role()) IN ('admin','manager','supervisor','md','fm','finance'));
