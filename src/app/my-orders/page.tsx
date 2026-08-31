import { AppShell } from "@/components/shell/app-shell";
import { TopBar } from "@/components/shell/topbar";
import { RestrictedAccess } from "@/components/shell/restricted-access";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { ADMIN_ROLES, RAISE_ORDER_ROLES, hasRole } from "@/lib/nav-config";
import { getInvoicePaymentSumsByOrderNo, withEffectiveDeposits } from "@/lib/effective-deposit";
import { OrderTrackerClient, type JobOrderRow, type JobRow } from "./order-tracker-client";

const PRODUCTION_STATUSES = ["In Production", "At Warehouse"];

async function getMyOrders(email: string) {
  const supabase = await createClient();

  const { data: ordersData } = await supabase
    .from("job_orders")
    .select("*")
    .eq("created_by", email)
    .order("created_at", { ascending: true });

  const rawOrders = (ordersData ?? []) as JobOrderRow[];

  // Deposit-sync fix, Phase 1 (2026-08-31): deposit_amount becomes the
  // real SUM of linked invoice payment(s) for a linked order.
  const invoicePaymentSums = await getInvoicePaymentSumsByOrderNo(supabase);
  const orders = withEffectiveDeposits(rawOrders, invoicePaymentSums);

  const productionOrderNos = Array.from(
    new Set(
      orders
        .filter((order) => order.status && PRODUCTION_STATUSES.includes(order.status))
        .map((order) => order.job_order_no)
        .filter((no): no is string => Boolean(no))
    )
  );

  let jobs: JobRow[] = [];
  if (productionOrderNos.length > 0) {
    const { data: jobsData } = await supabase
      .from("jobs")
      .select("*")
      .in("job_order_no", productionOrderNos);
    jobs = (jobsData ?? []) as JobRow[];
  }

  return { orders, jobs };
}

export default async function MyOrdersPage() {
  // ADMIN_ROLES | RAISE_ORDER_ROLES — was unrestricted (any authenticated
  // user); narrowed deliberately later. See nav-config.ts.
  const user = await requireUser();
  const allowed = hasRole(user.role, [...ADMIN_ROLES, ...RAISE_ORDER_ROLES]);

  const { orders, jobs } = allowed ? await getMyOrders(user.email) : { orders: [], jobs: [] };

  return (
    <AppShell userName={user.fullName} userRole={user.role} role={user.role} isSalesRep={user.isSalesRep}>
      <TopBar
        title="Appointed Time Printing Ltd."
        subtitle="Secured Capacity Planning Engine"
      />

      <div className="mb-2 text-lg font-bold text-at-navy-soft">My Order Tracker</div>

      {!allowed ? (
        <RestrictedAccess message="My Order Tracker is reserved for Front Desk staff, Operations, and administrators." />
      ) : orders.length === 0 ? (
        <div className="rounded-at-lg border border-at-border bg-at-white p-6 text-sm text-at-slate shadow-at-sm">
          No job orders found under your account. Use &quot;Raise Job Order&quot; to
          submit your first contract.
        </div>
      ) : (
        <OrderTrackerClient orders={orders} jobs={jobs} />
      )}
    </AppShell>
  );
}
