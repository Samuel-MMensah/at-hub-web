import { AppShell } from "@/components/shell/app-shell";
import { TopBar } from "@/components/shell/topbar";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { RaiseOrderClient, type ResubmitOrderData } from "./raise-order-client";

// Hand-off from My Order Tracker's "Modify & Resubmit" link
// (order-tracker-client.tsx): /raise-order?resubmit={id}. Matches how
// the source actually switches into resubmit mode — resubmit_data is
// the ENTIRE original rejected job_orders row (every _rd()/_rdf()/
// _rdi()/_rdd()/_rdl() call in both resubmit forms reads straight off
// it), not a purpose-built subset — so this fetches select("*") for
// exactly one row, re-verified fresh server-side rather than trusting
// anything the client could have passed: must actually be Rejected,
// and must actually belong to the requesting user (created_by ===
// their email, the same scoping My Order Tracker's own query already
// uses) — a stale or guessed order id in the URL should not let
// someone resubmit an order that isn't theirs, or isn't even rejected.
async function getResubmitOrder(orderId: number, userEmail: string): Promise<ResubmitOrderData | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("job_orders").select("*").eq("id", orderId).single();

  if (!data || data.status !== "Rejected" || data.created_by !== userEmail) {
    return null;
  }
  return data as ResubmitOrderData;
}

export default async function RaiseOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ resubmit?: string }>;
}) {
  // No role gate — matches app.py: any authenticated user (unlike
  // Authorization Center / Archive / Production Layout Builder, which
  // all check "and is_admin"). nav-config.ts's existing entry for this
  // route already has no `roles` restriction either.
  const user = await requireUser();

  const { resubmit } = await searchParams;
  const resubmitId = resubmit ? Number(resubmit) : null;
  const resubmitRequestedButInvalid = resubmitId !== null && Number.isNaN(resubmitId) === false;
  const resubmitOrder =
    resubmitId !== null && !Number.isNaN(resubmitId) ? await getResubmitOrder(resubmitId, user.email) : null;

  return (
    <AppShell userName={user.fullName} userRole={user.role} role={user.role}>
      <TopBar title="Appointed Time Printing Ltd." subtitle="Secured Capacity Planning Engine" />

      {resubmitRequestedButInvalid && !resubmitOrder && (
        <div className="mb-4 rounded-at border border-red-300 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
          That order can&apos;t be resubmitted — it may not be rejected, may not belong to your
          account, or may no longer exist. Showing the normal Raise Job Order form instead.
        </div>
      )}

      <RaiseOrderClient userEmail={user.email} resubmitOrder={resubmitOrder} />
    </AppShell>
  );
}
