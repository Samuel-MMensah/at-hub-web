import { AppShell } from "@/components/shell/app-shell";
import { TopBar } from "@/components/shell/topbar";
import { RestrictedAccess } from "@/components/shell/restricted-access";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { ADMIN_ROLES, WAREHOUSE_ROLES, hasRole } from "@/lib/nav-config";
import { parseTimestamptz } from "@/lib/parse-timestamptz";
import { currentMonthKey, groupByMonth, type MonthGroup } from "@/lib/month-groups";
import { getStockBalance } from "@/app/warehouse-inventory/stock-balance/page";
import { getMaterialOptions, getReceiptHistory } from "@/app/warehouse-inventory/material-receipts/page";
import { getJobOrderOptions, getIssuanceHistory } from "@/app/warehouse-inventory/material-issuances/page";
import { WarehouseTabs, type WarehouseOrderRow } from "./warehouse-tabs";

async function getWarehouseOrders() {
  const supabase = await createClient();

  const { data } = await supabase
    .from("job_orders")
    .select(
      "id, job_order_no, customer_name, qty_to_print, warehouse_notified_finance, department, type_of_print, print_type, created_at"
    )
    .eq("status", "At Warehouse")
    .order("created_at", { ascending: true });

  return (data ?? []) as WarehouseOrderRow[];
}

export default async function WarehousePage() {
  const user = await requireUser();
  const allowed = hasRole(user.role, [...ADMIN_ROLES, ...WAREHOUSE_ROLES]);

  // Phase 5: Stock Balance / Material Receipts / Material Issuance are
  // reused as-is from their standalone routes (same exported queries,
  // same Client Components) — this is the single, shared role gate for
  // all four tabs. A user who fails it never reaches any tab's data or
  // markup; there's no per-tab partial-access state to worry about.
  const [orders, stockBalance, materials, receipts, jobOrders, issuances] = allowed
    ? await Promise.all([
        getWarehouseOrders(),
        getStockBalance(),
        getMaterialOptions(),
        getReceiptHistory(),
        getJobOrderOptions(),
        getIssuanceHistory(),
      ])
    : [[], [], [], [], [], []];

  // Same month-grouping convention as Audit Log / My Order Tracker
  // (src/lib/month-groups.ts) — UTC calendar month, current month
  // expanded by default. Unchanged from pre-Phase-5 warehouse/page.tsx,
  // just now passed into WarehouseTabs instead of rendered inline.
  const withDate = orders.filter((o) => o.created_at);
  const withoutDate = orders.filter((o) => !o.created_at);
  const monthGroups: MonthGroup<WarehouseOrderRow>[] = groupByMonth(withDate, (o) =>
    parseTimestamptz(o.created_at as string)
  );
  if (withoutDate.length > 0) {
    monthGroups.push({ key: "", label: "Unknown Date", items: withoutDate });
  }
  const currentKey = currentMonthKey();

  return (
    <AppShell userName={user.fullName} userRole={user.role} role={user.role}>
      <TopBar
        title="Appointed Time Printing Ltd."
        subtitle="Secured Capacity Planning Engine"
      />

      <div className="mb-2 text-lg font-bold text-at-navy-soft">Warehouse</div>

      {!allowed ? (
        <RestrictedAccess message="Warehouse is reserved for warehouse staff and administrators." />
      ) : (
        <WarehouseTabs
          monthGroups={monthGroups}
          currentKey={currentKey}
          stockBalance={stockBalance}
          materials={materials}
          receipts={receipts}
          jobOrders={jobOrders}
          issuances={issuances}
        />
      )}
    </AppShell>
  );
}
