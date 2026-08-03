import { AppShell } from "@/components/shell/app-shell";
import { TopBar } from "@/components/shell/topbar";
import { RestrictedAccess } from "@/components/shell/restricted-access";
import { PdfPreviewButton } from "@/components/ui/pdf-preview-button";
import { CollapsibleMonthGroup } from "@/components/ui/collapsible-month-group";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { ADMIN_ROLES, WAREHOUSE_ROLES, hasRole } from "@/lib/nav-config";
import { isGarment, type GarmentClassifiable } from "@/lib/is-garment";
import { parseTimestamptz } from "@/lib/parse-timestamptz";
import { currentMonthKey, groupByMonth, type MonthGroup } from "@/lib/month-groups";
import { NotifyFinanceButton } from "./notify-finance-button";

interface WarehouseOrderRow extends GarmentClassifiable {
  id: number;
  job_order_no: string | null;
  customer_name: string;
  qty_to_print: number;
  warehouse_notified_finance: boolean | null;
  created_at: string | null;
}

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

  const orders = allowed ? await getWarehouseOrders() : [];

  // Same month-grouping convention as Audit Log / My Order Tracker
  // (src/lib/month-groups.ts) — UTC calendar month, current month
  // expanded by default. No search/filter on this page, so there's no
  // isFiltering-driven force-expand case here, unlike those two.
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

      <div className="mb-2 text-lg font-bold text-at-navy-soft">Warehouse Receiving</div>

      {!allowed ? (
        <RestrictedAccess message="Warehouse is reserved for warehouse staff and administrators." />
      ) : orders.length === 0 ? (
        <div className="rounded-at-lg border border-at-border bg-at-white p-6 text-sm text-at-slate shadow-at-sm">
          Nothing waiting at the warehouse right now.
        </div>
      ) : (
        monthGroups.map((month) => (
          <CollapsibleMonthGroup
            key={month.key}
            monthLabel={month.label}
            itemCount={month.items.length}
            defaultExpanded={month.key === currentKey}
          >
            <div className="flex flex-col gap-4">
              {month.items.map((order) => {
                const orderNo = order.job_order_no || "—";
                const alreadyNotified = Boolean(order.warehouse_notified_finance);
                const garment = isGarment(order);

                return (
                  <div
                    key={order.id}
                    className="rounded-at-lg border border-at-border bg-at-white p-6 shadow-at-sm"
                  >
                    <div className="mb-0.5 text-[0.65rem] font-bold uppercase tracking-wide text-at-slate">
                      {orderNo} · At Warehouse
                    </div>
                    <div className="text-[1.15rem] font-extrabold text-at-navy">
                      {order.customer_name || "—"}
                    </div>
                    <div className="mt-1 text-sm text-at-slate">
                      Quantity: {order.qty_to_print ?? "—"}
                    </div>

                    {/* Compact pair of right-aligned actions, natural Button
                        size — matches Dispatch's card action-row convention
                        (default `md` Button, not fullWidth) and Production
                        Board's exact pairing of a status-action button with
                        PdfPreviewButton in the same flex row. */}
                    <div className="mt-4 flex items-center justify-end gap-3">
                      <NotifyFinanceButton orderId={order.id} initiallyNotified={alreadyNotified} />
                      <PdfPreviewButton
                        orderId={order.id}
                        label={garment ? "🧵 Preview Garment PDF" : "📄 Preview PDF"}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </CollapsibleMonthGroup>
        ))
      )}
    </AppShell>
  );
}
