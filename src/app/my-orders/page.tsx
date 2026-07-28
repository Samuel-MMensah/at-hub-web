import { AppShell } from "@/components/shell/app-shell";
import { TopBar } from "@/components/shell/topbar";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { OrderTrackerClient, type JobOrderRow, type JobRow } from "./order-tracker-client";

const PRODUCTION_STATUSES = ["In Production", "At Warehouse"];

async function getMyOrders(email: string) {
  const supabase = await createClient();

  const { data: ordersData } = await supabase
    .from("job_orders")
    .select("*")
    .eq("created_by", email)
    .order("created_at", { ascending: true });

  const orders = (ordersData ?? []) as JobOrderRow[];

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
  const user = await requireUser();
  const { orders, jobs } = await getMyOrders(user.email);

  return (
    <AppShell userName={user.fullName} userRole={user.role} role={user.role}>
      <TopBar
        title="Appointed Time Printing Ltd."
        subtitle="Secured Capacity Planning Engine"
      />

      <div className="mb-2 text-lg font-bold text-at-navy-soft">My Order Tracker</div>

      {orders.length === 0 ? (
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
