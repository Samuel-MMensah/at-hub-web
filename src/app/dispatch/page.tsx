import { AppShell } from "@/components/shell/app-shell";
import { TopBar } from "@/components/shell/topbar";
import { RestrictedAccess } from "@/components/shell/restricted-access";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { ADMIN_ROLES, FINANCE_ROLES, hasRole } from "@/lib/nav-config";
import { DispatchClient, type DispatchOrderRow } from "./dispatch-client";

const DISPATCH_STATUSES = ["In Production", "At Warehouse"];

async function getDispatchOrders() {
  const supabase = await createClient();

  const { data } = await supabase
    .from("job_orders")
    .select("id, job_order_no, customer_name, status, total_amount, deposit_amount, payment_terms")
    .in("status", DISPATCH_STATUSES)
    .order("created_at", { ascending: true });

  return (data ?? []) as DispatchOrderRow[];
}

export default async function DispatchPage() {
  const user = await requireUser();
  const allowed = hasRole(user.role, [...ADMIN_ROLES, ...FINANCE_ROLES]);

  const orders = allowed ? await getDispatchOrders() : [];

  return (
    <AppShell userName={user.fullName} userRole={user.role} role={user.role}>
      <TopBar
        title="Appointed Time Printing Ltd."
        subtitle="Secured Capacity Planning Engine"
      />

      <div className="mb-2 text-lg font-bold text-at-navy-soft">Dispatch</div>

      {!allowed ? (
        <RestrictedAccess message="Dispatch is reserved for managers and administrators." />
      ) : orders.length === 0 ? (
        <div className="rounded-at-lg border border-at-border bg-at-white p-6 text-sm text-at-slate shadow-at-sm">
          No orders currently in production or awaiting collection.
        </div>
      ) : (
        <DispatchClient orders={orders} />
      )}
    </AppShell>
  );
}
