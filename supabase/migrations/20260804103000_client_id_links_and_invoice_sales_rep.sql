-- Link client_id across job_orders + job_invoices; add direct sales_rep to
-- job_invoices for unlinked entries, guarded by a CHECK constraint.
-- Back-captured migration (see README.md) — applied to production 2026-08-04.
-- Timestamp: date real; time synthetic (ordering only).
-- Source: verbatim from the build session transcript.
-- Depends on: clients (20260804100000), job_orders (baseline), job_invoices (20260804090000).
-- The client_id backfill (54/54 rows) was DATA via a backend script, not DDL — not here.

ALTER TABLE job_orders ADD COLUMN client_id BIGINT REFERENCES clients(id);

ALTER TABLE job_invoices ADD COLUMN client_id BIGINT REFERENCES clients(id);
ALTER TABLE job_invoices ADD COLUMN sales_rep TEXT;

-- A row attributes its sales rep either via its linked job order OR via a direct
-- sales_rep value (for invoices with no job_order_no) — never both.
ALTER TABLE job_invoices ADD CONSTRAINT sales_rep_only_when_unlinked
  CHECK (job_order_no IS NULL OR sales_rep IS NULL);
