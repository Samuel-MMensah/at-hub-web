-- job_invoices: add edited_by/edited_at, for Invoice Entry's new Edit
-- capability. Same convention as materials_edit_tracking.sql
-- (material_receipts/material_issuances).
--
-- No new UPDATE policy needed here, unlike the materials migration —
-- job_invoices already has one from 20260804090000_job_invoices.sql
-- ("finance and admin can update invoices"), and it is role-gated only
-- (USING/WITH CHECK on current_user_role()) with no column-level
-- restriction, so it already covers a full-row update, not just the
-- payment/balance/receipt_no fields recordInvoicePayment writes.
-- Confirmed by reading that policy's definition directly, not assumed.

ALTER TABLE job_invoices ADD COLUMN edited_by TEXT;
ALTER TABLE job_invoices ADD COLUMN edited_at TIMESTAMPTZ;
