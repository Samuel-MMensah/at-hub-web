-- job_invoices.business_unit CHECK constraint: add SAMPLE, CSR, REPLACEMENT.
-- Applied to production 2026-08-15, via this migrations workflow (not
-- back-captured — this one was written before being run, per the standing
-- convention in supabase/migrations/README.md).
--
-- Constraint name confirmed live via a real error-message probe (an insert
-- attempt with business_unit='SAMPLE'), not guessed: the existing constraint
-- is the default-named `job_invoices_business_unit_check` (an unnamed inline
-- CHECK on this column auto-names to <table>_<column>_check — matches how
-- it was originally declared in 20260804090000_job_invoices.sql).
--
-- Why: real, recurring business categories Finance already tracks —
-- confirmed in the June 2026 reconciliation data (17 SAMPLE rows, 1 CSR row,
-- 1 REPLACEMENT row, not typos or one-offs) — that the original 4-value list
-- (WALK-IN/PRIVATE/SUBSIDIARY/GOVERNMENT) never covered. All three are $0
-- transactions (invoice_total = 0): free samples, CSR giveaways, and a
-- warranty/free replacement job.

ALTER TABLE job_invoices DROP CONSTRAINT job_invoices_business_unit_check;

ALTER TABLE job_invoices ADD CONSTRAINT job_invoices_business_unit_check
  CHECK (business_unit IN (
    'WALK-IN', 'PRIVATE', 'SUBSIDIARY', 'GOVERNMENT',
    'SAMPLE', 'CSR', 'REPLACEMENT'
  ));
