-- Sample-to-order conversion: converted_from_sample_id FK + sample_conversion_status
-- view — INITIAL view (state 1 of 2).
-- Back-captured migration (see README.md) — applied to production 2026-08-09.
-- Timestamp: date real; time synthetic (ordering only).
-- Source: verbatim from the build session transcript.
-- Depends on: job_orders sample fields (20260806090000).
--
-- The self-referencing FK is intentional: a follow-up real order points back to
-- the sample it converts from. It also means a sample with follow-ups can't be
-- deleted until its children are (a desirable, confirmed behavior). The view was
-- created WITH (security_invoker = true) from the start (the stock_balance lesson
-- already learned). It is extended in the next migration to expose the converted
-- order's id/number; do not collapse the two.

ALTER TABLE job_orders ADD COLUMN converted_from_sample_id BIGINT
  REFERENCES job_orders(id);

CREATE OR REPLACE VIEW sample_conversion_status
WITH (security_invoker = true) AS
SELECT
  s.id           AS sample_id,
  s.job_order_no AS sample_job_order_no,
  s.customer_name,
  s.client_id,
  s.sample_reason,
  s.order_date,
  EXISTS (
    SELECT 1
    FROM job_orders f
    WHERE f.converted_from_sample_id = s.id
      AND f.status IN ('Approved', 'In Production', 'At Warehouse', 'Delivered')
  ) AS is_converted
FROM job_orders s
WHERE s.is_sample = true;
