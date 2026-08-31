import { AppShell } from "@/components/shell/app-shell";
import { TopBar } from "@/components/shell/topbar";
import { RestrictedAccess } from "@/components/shell/restricted-access";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { ADMIN_ROLES, RAISE_ORDER_ROLES, hasRole } from "@/lib/nav-config";
import { RaiseOrderClient, type ResubmitOrderData, type ClientOption, type SampleOption } from "./raise-order-client";
import { getSalesReps } from "@/lib/sales-reps";

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

// Phase 2 of the clients subsystem — feeds the New Press/New Garment
// cart forms' client picker. Not fetched for resubmit mode (out of
// scope for this phase — resubmit edits an already-known order's
// existing customer, see raise-order-client.tsx).
async function getClients(): Promise<ClientOption[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("clients").select("id, name, phone, email").order("name", { ascending: true });
  return (data ?? []) as ClientOption[];
}

// Samples a new order can be linked to as its conversion. Scoped HERE
// (not in the client component) to awaiting-decision samples only —
// Complimentary samples never convert by definition, so they must
// never reach the picker.
async function getLinkableSamples(): Promise<SampleOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("job_orders")
    .select("id, job_order_no, customer_name, order_date")
    .eq("is_sample", true)
    .eq("sample_reason", "Awaiting Customer Decision")
    .order("order_date", { ascending: false });
  return (data ?? []) as SampleOption[];
}

export default async function RaiseOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ resubmit?: string }>;
}) {
  // ADMIN_ROLES | RAISE_ORDER_ROLES — was unrestricted (any authenticated
  // user, matching app.py); narrowed deliberately later. See nav-config.ts.
  const user = await requireUser();
  const allowed = hasRole(user.role, [...ADMIN_ROLES, ...RAISE_ORDER_ROLES]);

  const { resubmit } = await searchParams;
  const resubmitId = resubmit ? Number(resubmit) : null;
  const resubmitRequestedButInvalid = resubmitId !== null && Number.isNaN(resubmitId) === false;
  const resubmitOrder =
    allowed && resubmitId !== null && !Number.isNaN(resubmitId)
      ? await getResubmitOrder(resubmitId, user.email)
      : null;
  const [clients, salesReps, linkableSamples] =
    allowed && !resubmitOrder
      ? await Promise.all([getClients(), getSalesReps(), getLinkableSamples()])
      : [[], [], []];

  return (
    <AppShell userName={user.fullName} userRole={user.role} role={user.role} isSalesRep={user.isSalesRep}>
      <TopBar title="Appointed Time Printing Ltd." subtitle="Secured Capacity Planning Engine" />

      {!allowed ? (
        <RestrictedAccess message="Raise Job Order is reserved for Front Desk staff, Operations, and administrators." />
      ) : (
        <>
          {resubmitRequestedButInvalid && !resubmitOrder && (
            <div className="mb-4 rounded-at border border-at-danger bg-at-danger-bg px-4 py-3 text-sm font-semibold text-at-danger-text">
              That order can&apos;t be resubmitted — it may not be rejected, may not belong to
              your account, or may no longer exist. Showing the normal Raise Job Order form
              instead.
            </div>
          )}

          <RaiseOrderClient
            userFullName={user.fullName}
            resubmitOrder={resubmitOrder}
            clients={clients}
            salesReps={salesReps}
            linkableSamples={linkableSamples}
          />
        </>
      )}
    </AppShell>
  );
}
