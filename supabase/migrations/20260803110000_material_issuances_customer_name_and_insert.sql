-- material_issuances: add customer_name column + INSERT policy (Phase 4).
-- Back-captured migration (see README.md) — applied to production 2026-08-03.
-- Timestamp: date real; time synthetic (ordering only).
-- Source: verbatim from the build session transcript.
--
-- The "missing customer_name column" and issuances INSERT policy were added in
-- Phase 4 (Material Issuance), after the receipts INSERT policy of Phase 3.

ALTER TABLE material_issuances ADD COLUMN customer_name TEXT;

CREATE POLICY "warehouse and admin can insert issuances"
ON material_issuances FOR INSERT TO authenticated
WITH CHECK (lower(current_user_role()) IN ('admin','manager','supervisor','md','fm','warehouse'));
