import { createClient } from "@/lib/supabase/server";

// Shared by Raise Job Order's cart forms (job_orders.sales_rep) and
// Invoice Entry's standalone-invoice form (job_invoices.sales_rep) —
// same "shared, not duplicated" convention as isGarment/
// parseTimestamptz. Live source of truth: profiles.is_sales_rep, not
// a hardcoded name list — the two hardcoded SALES_REP_NAMES arrays
// this replaces had already silently drifted from reality (3 of 10
// names had no matching profile at all; one of those turned out to be
// an existing profile under a slightly different full_name, not a
// missing person). A profiles row with is_sales_rep=true is the one
// place this list can now go stale, and toggling it is a deliberate
// SQL change, not a self-service UI — see this task's own notes.
//
// Goes through get_sales_reps(), a SECURITY DEFINER RPC, NOT a direct
// .from("profiles") select — verified live (real Front Desk/Finance
// sessions, not assumed) that profiles' SELECT policy is self-scoped
// (auth.uid() = id) for every role, contrary to this task's original
// premise that it was public. A direct select here would silently
// return an empty list for every real caller except when querying
// their own row. The RPC runs as its creator and returns ONLY
// full_name for is_sales_rep=true rows — nothing else from profiles,
// and profiles' own RLS policy was NOT touched to make this work.
export interface SalesRepOption {
  full_name: string;
}

export async function getSalesReps(): Promise<SalesRepOption[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_sales_reps");
  return (data ?? []) as SalesRepOption[];
}
