-- profiles.is_sales_rep flag + get_sales_reps() SECURITY DEFINER RPC.
-- Back-captured migration (see README.md) — applied to production 2026-08-04.
-- Timestamp: date real; time synthetic (ordering only).
-- Source: verbatim from the build session transcript.
-- Depends on: profiles (baseline).
--
-- get_sales_reps() exists because profiles' self-scoped SELECT policy means a
-- caller can only see their OWN row — a direct `is_sales_rep = true` query
-- returns nothing. The SECURITY DEFINER RPC reads across profiles safely and is
-- GRANTed to authenticated so PostgREST exposes it as an .rpc() endpoint.

ALTER TABLE profiles ADD COLUMN is_sales_rep BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION get_sales_reps()
RETURNS TABLE(full_name TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT full_name FROM profiles WHERE is_sales_rep = true ORDER BY full_name;
$$;

-- Required for PostgREST to expose this as a callable RPC endpoint to real
-- (non-service-role) authenticated sessions.
GRANT EXECUTE ON FUNCTION get_sales_reps() TO authenticated;
