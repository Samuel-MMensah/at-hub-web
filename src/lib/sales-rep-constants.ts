// Split out from sales-reps.ts on purpose: that file imports
// @/lib/supabase/server (next/headers), which cannot reach a Client
// Component's bundle. This file has zero imports, so both Raise Job
// Order's cart forms and Invoice Entry's standalone-invoice form (Client
// Components) can import the constant directly without pulling in
// server-only code.

// The explicit, deliberate "no rep involved" choice for both Sales Rep
// dropdowns — a real value written to sales_rep, never blank/null by
// omission. Distinguishable both from a real rep's full_name and from
// the historical NULL rows written before Sales Rep became a required
// field (2026-08-30 revenue audit: going-forward only, not retroactive).
export const SALES_REP_WALK_IN = "Walk-in / No Sales Rep";
