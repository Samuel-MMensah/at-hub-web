-- sample_conversion_status view — FINAL state (state 2 of 2): expose the
-- converted order's id + number via a LATERAL join (built for the Samples view).
-- Back-captured migration (see README.md) — applied to production 2026-08-09.
-- Timestamp: date real; time synthetic (ordering only).
-- Source: verbatim from the build session transcript.
--
-- is_converted is now derived from the LATERAL result (converted_order_id IS NOT
-- NULL) rather than a separate EXISTS. security_invoker is re-declared here — it
-- must be restated on every CREATE OR REPLACE or it silently reverts to the
-- definer-privilege default (the stock_balance lesson).

CREATE OR REPLACE VIEW sample_conversion_status
WITH (security_invoker = true) AS
SELECT
  s.id           AS sample_id,
  s.job_order_no AS sample_job_order_no,
  s.customer_name,
  s.client_id,
  s.sample_reason,
  s.order_date,
  (conv.converted_order_id IS NOT NULL) AS is_converted,
  conv.converted_order_id,
  conv.converted_job_order_no
FROM job_orders s
LEFT JOIN LATERAL (
  SELECT f.id AS converted_order_id, f.job_order_no AS converted_job_order_no
  FROM job_orders f
  WHERE f.converted_from_sample_id = s.id
    AND f.status IN ('Approved', 'In Production', 'At Warehouse', 'Delivered')
  ORDER BY f.approval_date DESC NULLS LAST, f.id DESC
  LIMIT 1
) conv ON true
WHERE s.is_sample = true;
