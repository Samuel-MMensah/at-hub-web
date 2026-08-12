-- Materials edit capability: edited_by/edited_at columns + UPDATE policies
-- on material_receipts and material_issuances.
-- Back-captured migration (see README.md) — applied to production 2026-08-04.
-- Timestamp: date real; time synthetic (ordering only).
-- Source: verbatim from the build session transcript.
-- Depends on: current_user_role() and the materials tables/RLS above.

ALTER TABLE material_receipts ADD COLUMN edited_by TEXT;
ALTER TABLE material_receipts ADD COLUMN edited_at TIMESTAMPTZ;
ALTER TABLE material_issuances ADD COLUMN edited_by TEXT;
ALTER TABLE material_issuances ADD COLUMN edited_at TIMESTAMPTZ;

CREATE POLICY "warehouse and admin can update receipts"
ON material_receipts FOR UPDATE TO authenticated
USING (lower(current_user_role()) IN ('admin','manager','supervisor','md','fm','warehouse'))
WITH CHECK (lower(current_user_role()) IN ('admin','manager','supervisor','md','fm','warehouse'));

CREATE POLICY "warehouse and admin can update issuances"
ON material_issuances FOR UPDATE TO authenticated
USING (lower(current_user_role()) IN ('admin','manager','supervisor','md','fm','warehouse'))
WITH CHECK (lower(current_user_role()) IN ('admin','manager','supervisor','md','fm','warehouse'));
