import { AppShell } from "@/components/shell/app-shell";
import { TopBar } from "@/components/shell/topbar";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { getInvoicePaymentSumsByOrderNo, withEffectiveDeposits } from "@/lib/effective-deposit";
import { AuditLogClient, type AuditOrderRow } from "./audit-log-client";

// "Every order that isn't still a draft" — covers more statuses than
// Command Center's KPI queries (which only count Approved/In
// Production/At Warehouse as "active").
const AUDIT_LOG_STATUSES = [
  "Pending Approval",
  "Pending Revision Approval",
  "Approved",
  "In Production",
  "At Warehouse",
  "Ready for Collection",
  "Delivered",
  "Rejected",
];

async function getAuditOrders() {
  const supabase = await createClient();

  const { data } = await supabase
    .from("job_orders")
    .select(
      "id, job_order_no, customer_name, status, created_by, created_at, order_date, approved_by, approval_date, delivered_date, receipt_no, department, type_of_print, print_type, total_amount, deposit_amount, date_of_collection, rejection_note, sales_rep"
    )
    .in("status", AUDIT_LOG_STATUSES);

  const orders = (data ?? []) as AuditOrderRow[];

  // Deposit-sync fix, Phase 1 (2026-08-31): deposit_amount becomes the
  // real SUM of linked invoice payment(s) for a linked order.
  const invoicePaymentSums = await getInvoicePaymentSumsByOrderNo(supabase);
  return withEffectiveDeposits(orders, invoicePaymentSums);
}

export default async function AuditLogPage() {
  // No role gate — any authenticated user, matching Production
  // Board/Shop Floor Control's convention. Was ADMIN_ROLES-only
  // originally; opened up deliberately later (see nav-config.ts).
  const user = await requireUser();

  const orders = await getAuditOrders();

  return (
    <AppShell userName={user.fullName} userRole={user.role} role={user.role} isSalesRep={user.isSalesRep}>
      <TopBar
        title="Appointed Time Printing Ltd."
        subtitle="Secured Capacity Planning Engine"
      />

      <div className="mb-1 text-lg font-bold text-at-navy-soft">Audit Log</div>
      <div className="mb-4 text-sm text-at-slate">
        Who raised, approved, and moved each order — current recorded state, not a
        field-by-field edit history.
      </div>

      {orders.length === 0 ? (
        <div className="rounded-at-lg border border-at-border bg-at-white p-6 text-sm text-at-slate shadow-at-sm">
          No orders recorded yet.
        </div>
      ) : (
        <AuditLogClient orders={orders} />
      )}
    </AppShell>
  );
}
