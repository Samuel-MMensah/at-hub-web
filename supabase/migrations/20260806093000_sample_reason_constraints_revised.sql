-- job_orders sample constraints — FINAL live state (state 2 of 2).
-- Back-captured migration (see README.md).
-- Timestamp: date real (2026-08-06); time synthetic (ordering only).
--
-- ⚠ PARTIALLY RECONSTRUCTED — read this before trusting the statements below.
--
-- The live database ended up with TWO CHECK constraints on sample_reason:
--   • sample_reason_requires_flag  — sample_reason IS NULL OR is_sample = true
--   • sample_reason_valid_values   — sample_reason IS NULL OR sample_reason IN
--       ('Awaiting Customer Decision', 'Complimentary — No Charge Expected')
-- Both were confirmed live by real rejected inserts (the exact constraint name
-- Postgres reported on violation). BUT the exact statements that produced this
-- state were NOT fully captured, and the history is genuinely murky:
--   1. The previous migration applied `sample_reason_only_when_sample` (same
--      predicate as requires_flag). How it became `sample_reason_requires_flag`
--      — a DROP + re-ADD under the new name, vs. an ALTER ... RENAME CONSTRAINT
--      — is not recoverable from the record.
--   2. `sample_reason_valid_values` was noted in the project history as "a real
--      constraint I never wrote" — it appeared in the live DB but its authoring
--      statement is not in this project's transcript.
-- The statements below are therefore a FAITHFUL RECONSTRUCTION of the applied
-- END STATE (verified predicates), NOT verbatim copies of what was run. They are
-- written to be idempotent-ish and to land on the confirmed live shape.

-- Reconstructed: rename-by-replace of the state-1 constraint.
ALTER TABLE job_orders DROP CONSTRAINT IF EXISTS sample_reason_only_when_sample;
ALTER TABLE job_orders ADD CONSTRAINT sample_reason_requires_flag
  CHECK (sample_reason IS NULL OR is_sample = true);

-- Reconstructed from the live predicate (see note 2 above): value allowlist.
ALTER TABLE job_orders ADD CONSTRAINT sample_reason_valid_values
  CHECK (sample_reason IS NULL OR sample_reason IN (
    'Awaiting Customer Decision', 'Complimentary — No Charge Expected'
  ));
