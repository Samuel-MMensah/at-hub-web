-- job_orders sample / no-charge fields — INITIAL state (state 1 of 2).
-- Back-captured migration (see README.md) — applied to production 2026-08-06.
-- Timestamp: date real; time synthetic (ordering only).
-- Source: verbatim from the build session transcript.
--
-- This is the ORIGINAL applied state: a single CHECK named
-- `sample_reason_only_when_sample`. The live constraint set later diverged (a
-- differently-named requires-flag constraint plus a value-allowlist constraint
-- that this project did not author) — captured honestly in the next migration,
-- 20260806093000_sample_reason_constraints_revised.sql. Do not "correct" this
-- file; it records what was run first.

ALTER TABLE job_orders ADD COLUMN is_sample BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE job_orders ADD COLUMN sample_reason TEXT;
ALTER TABLE job_orders ADD CONSTRAINT sample_reason_only_when_sample
  CHECK (sample_reason IS NULL OR is_sample = true);
