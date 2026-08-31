import { AppShell } from "@/components/shell/app-shell";
import { TopBar } from "@/components/shell/topbar";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { ProductionBoardClient, type ProductionOrderRow } from "./production-board-client";

const PRODUCTION_BOARD_STATUSES = ["Approved", "In Production"];

async function getProductionOrders() {
  const supabase = await createClient();

  const { data } = await supabase
    .from("job_orders")
    .select(
      "id, job_order_no, customer_name, job_description, department, type_of_print, print_type, status, total_amount, qty_to_print, is_sample, sample_reason"
    )
    .in("status", PRODUCTION_BOARD_STATUSES)
    .order("created_at", { ascending: true });

  return (data ?? []) as ProductionOrderRow[];
}

export default async function ProductionBoardPage() {
  // No role gate — matches production.py: any authenticated user, same
  // posture as Command Center/Shop Floor Control. department only
  // affects whether the department filter is locked, not access itself.
  const user = await requireUser();
  const orders = await getProductionOrders();

  const normalizedDept = user.department.trim().toUpperCase();
  const lockedDept = normalizedDept === "PRESS" || normalizedDept === "GARMENT" ? normalizedDept : null;

  return (
    <AppShell userName={user.fullName} userRole={user.role} role={user.role} isSalesRep={user.isSalesRep}>
      <TopBar
        title="Appointed Time Printing Ltd."
        subtitle="Secured Capacity Planning Engine"
      />

      <div className="mb-2 text-lg font-bold text-at-navy-soft">Production Board</div>

      {orders.length === 0 ? (
        <div className="rounded-at-lg border border-at-border bg-at-white p-6 text-sm text-at-slate shadow-at-sm">
          No orders yet.
        </div>
      ) : (
        <ProductionBoardClient orders={orders} lockedDept={lockedDept} />
      )}
    </AppShell>
  );
}
