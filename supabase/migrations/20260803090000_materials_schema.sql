-- Materials inventory schema: material_catalog, material_receipts, material_issuances.
-- Back-captured migration (see README.md) — applied to production 2026-08-03;
-- recorded here for version control, NOT originally applied via this folder.
-- Timestamp: date real (git); time synthetic (ordering only).
-- Source: verbatim from the build session transcript.
--
-- NOTE: RLS was deliberately NOT enabled at this point ("No RLS on any of
-- these three — matches the existing project-wide convention"). RLS +
-- current_user_role() were added afterward — see 20260803100000_materials_rls.sql.
-- The 479-row material_catalog seed was a DATA import via a backend service-role
-- script, not DDL, and is intentionally not part of this migration.

CREATE TABLE material_catalog (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  material_description TEXT NOT NULL UNIQUE,
  section_group TEXT NOT NULL,
  material_category TEXT NOT NULL,
  uom TEXT,
  opening_inventory INTEGER NOT NULL DEFAULT 0,
  unit_cost_ghc NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE material_receipts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  date DATE NOT NULL,
  vendor_name TEXT,
  material_id BIGINT NOT NULL REFERENCES material_catalog(id),
  qty INTEGER NOT NULL,
  unit_cost NUMERIC NOT NULL,
  total_cost NUMERIC GENERATED ALWAYS AS (qty * unit_cost) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE material_issuances (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  date DATE NOT NULL,
  job_order_no TEXT REFERENCES job_orders(job_order_no),
  material_id BIGINT NOT NULL REFERENCES material_catalog(id),
  qty INTEGER NOT NULL,
  unit_cost NUMERIC NOT NULL,
  total_cost NUMERIC GENERATED ALWAYS AS (qty * unit_cost) STORED,
  user_department TEXT,
  oracle_req_no TEXT,
  document TEXT,
  oracle_shipment_no TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
