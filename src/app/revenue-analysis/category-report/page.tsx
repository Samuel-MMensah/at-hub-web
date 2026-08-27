import { AppShell } from "@/components/shell/app-shell";
import { TopBar } from "@/components/shell/topbar";
import { RestrictedAccess } from "@/components/shell/restricted-access";
import { requireUser } from "@/lib/auth";
import { ADMIN_ROLES, FINANCE_ROLES, hasRole } from "@/lib/nav-config";
import { getInvoiceHistory, getJobOrderOptions } from "../invoice-entry/page";
import { CategoryReportClient } from "./category-report-client";

// Standalone route, same pattern as Revenue Analysis / Invoice Entry
// (both exist at their own URL AND are embedded as a Dispatch tab —
// see dispatch/page.tsx + dispatch-tabs.tsx). Reuses getInvoiceHistory()
// as-is rather than a new query: it already selects every column this
// report needs (job_order_no, product_description, quantity, amount,
// invoice_total, ...), and Dispatch's tabbed page already fetches it
// once for Invoice Entry's own history table — the same array is
// reused for this tab too, not refetched.
// getJobOrderOptions() reused the same way — Dispatch's tabbed page
// already fetches it for Invoice Entry's own order picker, and it now
// carries job_orders.sales_rep, which the Sales Rep column joins
// through to for LINKED invoices (job_invoices.sales_rep is always
// null in that case — see effectiveSalesRep() in category-report-client.tsx).
export default async function CategoryReportPage() {
  const user = await requireUser();
  const allowed = hasRole(user.role, [...ADMIN_ROLES, ...FINANCE_ROLES]);

  const [invoices, jobOrders] = allowed ? await Promise.all([getInvoiceHistory(), getJobOrderOptions()]) : [[], []];

  return (
    <AppShell userName={user.fullName} userRole={user.role} role={user.role} isSalesRep={user.isSalesRep}>
      <TopBar title="Appointed Time Printing Ltd." subtitle="Secured Capacity Planning Engine" />

      <div className="mb-1 text-lg font-bold text-at-navy-soft">Category Report</div>
      <div className="mb-4 text-sm text-at-slate">
        Filter invoices by category and date range, then export as CSV or PDF.
      </div>

      {!allowed ? (
        <RestrictedAccess message="Category Report is reserved for finance staff and administrators." />
      ) : (
        <CategoryReportClient invoices={invoices} jobOrders={jobOrders} />
      )}
    </AppShell>
  );
}
