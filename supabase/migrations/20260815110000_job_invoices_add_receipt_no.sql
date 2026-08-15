-- job_invoices: add receipt_no, for audit-trail parity with job_orders'
-- own receipt_no column (already written by Dispatch's/Archive's
-- recordPayment). Applied to production 2026-08-15, via this migrations
-- workflow (not back-captured) — Invoice Entry's Record Payment gains a
-- Receipt Number field matching Dispatch's exact one (same label,
-- placeholder, optional-text convention), so job_invoices needs
-- somewhere to store it. Nullable, matching oracle_no's existing
-- optional-text convention on this same table.

ALTER TABLE job_invoices ADD COLUMN receipt_no TEXT;
