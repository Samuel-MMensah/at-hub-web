import { AppShell } from "@/components/shell/app-shell";
import { TopBar } from "@/components/shell/topbar";
import { RestrictedAccess } from "@/components/shell/restricted-access";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { ADMIN_ROLES, hasRole } from "@/lib/nav-config";
import { getInvoicePaymentSumsByOrderNo, withEffectiveDeposits } from "@/lib/effective-deposit";
import { AuthorizationClient, type PendingOrderRow } from "./authorization-client";

// Matches fetch_pending_orders_cached() in app.py: deliberately NOT capped
// with .limit() — every row here is something a manager still needs to act
// on, so truncating this list would hide part of the real queue rather than
// reduce it. If this ever legitimately runs into the thousands, the fix is
// a status index plus real server-side pagination, not a silent row cap.
const PENDING_STATUSES = ["Pending Approval", "Pending Revision Approval"];

async function getPendingOrders() {
  const supabase = await createClient();
  const { data } = await supabase.from("job_orders").select("*").in("status", PENDING_STATUSES);
  const orders = (data ?? []) as PendingOrderRow[];

  // Deposit-sync fix, Phase 1 (2026-08-31): deposit_amount becomes the
  // real SUM of linked invoice payment(s) for a linked order — a
  // Pending order can already have one (Invoice Entry's order picker
  // allows linking to an order of any status), so this isn't purely
  // theoretical here either.
  const invoicePaymentSums = await getInvoicePaymentSumsByOrderNo(supabase);
  return withEffectiveDeposits(orders, invoicePaymentSums);
}

export default async function AuthorizationPage() {
  // Matches rbac.py's is_admin() convention, same as Audit Log: ADMIN_ROLES
  // only, not unioned with Warehouse/Finance like the ops routes are.
  const user = await requireUser();
  const allowed = hasRole(user.role, ADMIN_ROLES);

  const orders = allowed ? await getPendingOrders() : [];

  return (
    <AppShell userName={user.fullName} userRole={user.role} role={user.role} isSalesRep={user.isSalesRep}>
      <TopBar title="Appointed Time Printing Ltd." subtitle="Secured Capacity Planning Engine" />

      <div className="mb-4 text-lg font-bold text-at-navy-soft">Executive Authorization Control Panel</div>

      {!allowed ? (
        <RestrictedAccess icon="🔒" message="The Authorization Center is reserved for administrators." />
      ) : (
        <AuthorizationClient orders={orders} />
      )}
    </AppShell>
  );
}
