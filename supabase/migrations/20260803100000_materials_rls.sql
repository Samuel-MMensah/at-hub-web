-- Materials RLS foundation: current_user_role() + enable RLS + SELECT policies
-- (all three tables) + material_receipts INSERT policy.
-- Back-captured migration (see README.md) — applied to production 2026-08-03,
-- AFTER the tables existed (they were created without RLS first).
-- Timestamp: date real; time synthetic (ordering only).
-- Source: policy/function bodies verbatim from the transcript. See ENABLE note.
--
-- current_user_role() is the shared role helper every role-based RLS policy in
-- this project keys on. It was first created HERE (during the materials RLS
-- work), NOT with job_invoices — it predates job_invoices.
--
-- RECONSTRUCTED (flagged): the exact `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
-- statements for the three materials tables were not captured verbatim in the
-- transcript. They are required for the policies below to take effect, and the
-- live tables enforce these policies, so the ENABLE statements are included here
-- as a faithful reconstruction of the applied state — not copied verbatim.

CREATE OR REPLACE FUNCTION current_user_role() RETURNS text AS $$
  SELECT role FROM profiles WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ENABLE RLS (reconstructed — see header note).
ALTER TABLE material_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_issuances ENABLE ROW LEVEL SECURITY;

-- SELECT: admins + warehouse can read the inventory on all three tables.
CREATE POLICY "admin and warehouse can read materials"
ON material_catalog FOR SELECT TO authenticated
USING (lower(current_user_role()) IN ('admin','manager','supervisor','md','fm','warehouse'));

CREATE POLICY "admin and warehouse can read materials"
ON material_receipts FOR SELECT TO authenticated
USING (lower(current_user_role()) IN ('admin','manager','supervisor','md','fm','warehouse'));

CREATE POLICY "admin and warehouse can read materials"
ON material_issuances FOR SELECT TO authenticated
USING (lower(current_user_role()) IN ('admin','manager','supervisor','md','fm','warehouse'));

-- INSERT (receipts): the "missing INSERT RLS policy" added in Phase 3.
CREATE POLICY "warehouse and admin can insert receipts"
ON material_receipts FOR INSERT TO authenticated
WITH CHECK (lower(current_user_role()) IN ('admin','manager','supervisor','md','fm','warehouse'));
