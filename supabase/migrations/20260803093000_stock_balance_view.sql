-- stock_balance view — INITIAL state (state 1 of 2).
-- Back-captured migration (see README.md) — applied to production 2026-08-03.
-- Timestamp: date real; time synthetic (ordering only).
-- Source: verbatim from the build session transcript.
--
-- IMPORTANT — this is the ORIGINAL, BUGGY state, captured deliberately (not
-- collapsed into the final view): created with NO `security_invoker`, so it ran
-- with the view creator's privileges (SECURITY DEFINER semantics) and silently
-- BYPASSED RLS. That was later found and fixed, and cost-tracking columns added,
-- in 20260803120000_stock_balance_costs_and_security_invoker.sql. Do not
-- "correct" this file — it records what was actually run first.

CREATE VIEW stock_balance AS
SELECT
  mc.id AS material_id,
  mc.material_description,
  mc.section_group,
  mc.material_category,
  mc.uom,
  mc.opening_inventory,
  COALESCE(r.total_qty, 0) AS receipts,
  COALESCE(i.total_qty, 0) AS issuances,
  mc.opening_inventory + COALESCE(r.total_qty, 0) - COALESCE(i.total_qty, 0) AS on_hand,
  mc.unit_cost_ghc,
  mc.unit_cost_ghc * (mc.opening_inventory + COALESCE(r.total_qty, 0) - COALESCE(i.total_qty, 0)) AS value
FROM material_catalog mc
LEFT JOIN (
  SELECT material_id, SUM(qty) AS total_qty FROM material_receipts GROUP BY material_id
) r ON r.material_id = mc.id
LEFT JOIN (
  SELECT material_id, SUM(qty) AS total_qty FROM material_issuances GROUP BY material_id
) i ON i.material_id = mc.id;
