-- stock_balance view — FINAL state (state 2 of 2): weighted-average +
-- most-recent cost columns, AND the security_invoker fix for the RLS-bypass bug.
-- Back-captured migration (see README.md) — applied to production 2026-08-03.
-- Timestamp: date real; time synthetic (ordering only).
-- Source: view body verbatim from the transcript.
--
-- TWO real corrective steps are folded here, both captured honestly:
--   1. The RLS-bypass fix. The original view (20260803093000) had no
--      security_invoker, so it ran with definer privileges and bypassed RLS.
--      The transcript shows a standalone fix was applied to that original view:
--          ALTER VIEW public.stock_balance SET (security_invoker = true);
--      It is recorded here as a comment rather than re-run, because the
--      CREATE OR REPLACE below re-declares `security_invoker = true` and fully
--      supersedes it — running the bare ALTER first would be redundant in a
--      clean replay. (Exact ordering of the ALTER vs. this rebuild on 2026-08-03
--      is not precisely recoverable; the final applied state is what this file
--      reproduces.)
--   2. The cost-tracking rebuild that added weighted_avg_cost / most_recent_cost.

CREATE OR REPLACE VIEW public.stock_balance
WITH (security_invoker = true) AS
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
  CASE
    WHEN (mc.opening_inventory + COALESCE(r.total_qty, 0)) = 0 THEN mc.unit_cost_ghc
    ELSE (mc.opening_inventory * mc.unit_cost_ghc + COALESCE(r.total_cost, 0))
         / (mc.opening_inventory + COALESCE(r.total_qty, 0))
  END AS weighted_avg_cost,
  COALESCE(mr.unit_cost, mc.unit_cost_ghc) AS most_recent_cost,
  (mc.opening_inventory + COALESCE(r.total_qty, 0) - COALESCE(i.total_qty, 0))
  * CASE
      WHEN (mc.opening_inventory + COALESCE(r.total_qty, 0)) = 0 THEN mc.unit_cost_ghc
      ELSE (mc.opening_inventory * mc.unit_cost_ghc + COALESCE(r.total_cost, 0))
           / (mc.opening_inventory + COALESCE(r.total_qty, 0))
    END AS value
FROM material_catalog mc
LEFT JOIN (
  SELECT material_id, SUM(qty) AS total_qty, SUM(total_cost) AS total_cost
  FROM material_receipts
  GROUP BY material_id
) r ON r.material_id = mc.id
LEFT JOIN (
  SELECT material_id, SUM(qty) AS total_qty
  FROM material_issuances
  GROUP BY material_id
) i ON i.material_id = mc.id
LEFT JOIN LATERAL (
  SELECT unit_cost
  FROM material_receipts mr2
  WHERE mr2.material_id = mc.id
  ORDER BY mr2.date DESC, mr2.created_at DESC, mr2.id DESC
  LIMIT 1
) mr ON true;
