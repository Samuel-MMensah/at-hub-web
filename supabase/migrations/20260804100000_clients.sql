-- clients: schema + RLS.
-- Back-captured migration (see README.md) — applied to production 2026-08-04.
-- Timestamp: date real; time synthetic (ordering only).
-- Source: verbatim from the build session transcript.
-- Depends on: current_user_role() (20260803100000).
-- The client seed was DATA via a backend service-role script, not DDL — not here.

CREATE TABLE clients (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  phone TEXT,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

-- SELECT: any authenticated user, matching job_orders' existing convention —
-- anyone raising or viewing an order needs to look up a client.
CREATE POLICY "any authenticated user can view clients"
ON clients FOR SELECT TO authenticated
USING (true);

-- INSERT: exactly who can raise job orders (ADMIN_ROLES | front desk |
-- operations), since Phase 2 lets those same people create a new client inline.
CREATE POLICY "raise-order roles can insert clients"
ON clients FOR INSERT TO authenticated
WITH CHECK (lower(current_user_role()) IN ('admin','manager','supervisor','md','fm','front desk','operations'));

-- UPDATE: ADMIN_ROLES only — correcting an existing client record is more
-- deliberate than creating one, kept narrower than INSERT.
CREATE POLICY "admins can update clients"
ON clients FOR UPDATE TO authenticated
USING (lower(current_user_role()) IN ('admin','manager','supervisor','md','fm'))
WITH CHECK (lower(current_user_role()) IN ('admin','manager','supervisor','md','fm'));
