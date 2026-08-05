import { AppShell } from "@/components/shell/app-shell";
import { TopBar } from "@/components/shell/topbar";
import { RestrictedAccess } from "@/components/shell/restricted-access";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { ADMIN_ROLES, FINANCE_ROLES, hasRole } from "@/lib/nav-config";
import { RevenueAnalysisClient, type InvoiceRow } from "./revenue-analysis-client";

// Phase 2 — read-only, standalone (not wired into Dispatch's UI yet,
// that's Phase 4). Gated to the same roles who can even read
// job_invoices under RLS (admin/manager/supervisor/md/fm + finance,
// matching Dispatch's own ADMIN_ROLES|FINANCE_ROLES gate) — a
// non-finance user landing here would get zero rows from the query
// anyway.
//
// 172 rows total, a modest, slow-growing historical dataset — fetched
// whole and aggregated client-side (Weekly/Monthly × category), same
// architecture as Command Center's own TrendCharts (groupTrend), not
// a database view. That's a deliberate difference from Stock
// Balance's stock_balance view: this table doesn't have a live,
// per-row-growing running balance that needs DB-side incremental
// aggregation at scale — it's a fixed reporting query over ~172 rows.
// Exported so Dispatch's tabbed page (src/app/dispatch/page.tsx) can
// reuse this exact query instead of duplicating it — Phase 4 wires
// this standalone route's content into a Dispatch tab without moving
// or rebuilding it. This route itself is untouched and still works at
// its own URL.
export async function getInvoices(): Promise<InvoiceRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("job_invoices")
    .select("id, date, customer_name, revenue_category, business_unit, invoice_total, payment, balance")
    .order("date", { ascending: true });
  return (data ?? []) as InvoiceRow[];
}

export default async function RevenueAnalysisPage() {
  const user = await requireUser();
  const allowed = hasRole(user.role, [...ADMIN_ROLES, ...FINANCE_ROLES]);

  const invoices = allowed ? await getInvoices() : [];

  return (
    <AppShell userName={user.fullName} userRole={user.role} role={user.role} isSalesRep={user.isSalesRep}>
      <TopBar
        title="Appointed Time Printing Ltd."
        subtitle="Secured Capacity Planning Engine"
      />

      <div className="mb-1 text-lg font-bold text-at-navy-soft">Revenue Analysis</div>
      <div className="mb-4 text-sm text-at-slate">
        Invoice Total by revenue category, grouped by week or month.
      </div>

      {!allowed ? (
        <RestrictedAccess message="Revenue Analysis is reserved for finance staff and administrators." />
      ) : (
        <RevenueAnalysisClient invoices={invoices} />
      )}
    </AppShell>
  );
}
