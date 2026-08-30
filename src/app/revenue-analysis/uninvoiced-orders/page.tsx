import { AppShell } from "@/components/shell/app-shell";
import { TopBar } from "@/components/shell/topbar";
import { RestrictedAccess } from "@/components/shell/restricted-access";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { ADMIN_ROLES, FINANCE_ROLES, hasRole } from "@/lib/nav-config";
import { ARCHIVE_STATUSES } from "@/app/archive/page";
import { UninvoicedOrdersClient, type UninvoicedOrderRow } from "./uninvoiced-orders-client";

// Worklist: approved-and-beyond orders (same 5-status scope Archive and
// Departmental Performance use — imported from Archive's own export, NOT
// redefined here) that have never been invoiced. "Never invoiced" is a
// fetch-both-and-diff-in-JS on the server, not a raw SQL NOT EXISTS:
// both tables are small (under 100 / under 500 rows), and this matches
// this codebase's established approach for datasets this size (Category
// Report does the same thing) rather than introducing a new RPC for one
// query. Logically equivalent to:
//   job_orders WHERE status IN (...) AND NOT EXISTS
//     (SELECT 1 FROM job_invoices WHERE job_invoices.job_order_no = job_orders.job_order_no)
export async function getUninvoicedOrders(): Promise<UninvoicedOrderRow[]> {
  const supabase = await createClient();
  const [ordersRes, invoicesRes] = await Promise.all([
    supabase
      .from("job_orders")
      .select(
        "id, job_order_no, customer_name, department, type_of_print, print_type, status, total_amount, order_date, sales_rep"
      )
      .in("status", ARCHIVE_STATUSES),
    supabase.from("job_invoices").select("job_order_no").not("job_order_no", "is", null),
  ]);

  const orders = (ordersRes.data ?? []) as UninvoicedOrderRow[];
  const invoicedOrderNos = new Set((invoicesRes.data ?? []).map((r) => r.job_order_no as string));
  return orders.filter((o) => o.job_order_no && !invoicedOrderNos.has(o.job_order_no));
}

// Standalone route, same dual-access pattern as Revenue Analysis /
// Invoice Entry / Category Report — also embedded as a Dispatch tab
// (dispatch/page.tsx reuses this exact getUninvoicedOrders()).
export default async function UninvoicedOrdersPage() {
  const user = await requireUser();
  const allowed = hasRole(user.role, [...ADMIN_ROLES, ...FINANCE_ROLES]);

  const orders = allowed ? await getUninvoicedOrders() : [];

  return (
    <AppShell userName={user.fullName} userRole={user.role} role={user.role} isSalesRep={user.isSalesRep}>
      <TopBar title="Appointed Time Printing Ltd." subtitle="Secured Capacity Planning Engine" />

      <div className="mb-1 text-lg font-bold text-at-navy-soft">Uninvoiced Orders</div>
      <div className="mb-1 text-sm text-at-slate">
        Approved-or-beyond orders that have never been invoiced — click an order number to create its invoice.
      </div>
      {/* MANDATORY, permanent caption — not a tooltip. Same convention as
          Revenue Analysis's AR Aging caption. */}
      <div className="mb-4 text-xs text-at-slate">All-time — there&apos;s no date filter on this list.</div>

      {!allowed ? (
        <RestrictedAccess message="Uninvoiced Orders is reserved for finance staff and administrators." />
      ) : (
        <UninvoicedOrdersClient orders={orders} />
      )}
    </AppShell>
  );
}
