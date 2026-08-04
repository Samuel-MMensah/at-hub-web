import { AppShell } from "@/components/shell/app-shell";
import { TopBar } from "@/components/shell/topbar";
import { RestrictedAccess } from "@/components/shell/restricted-access";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { ADMIN_ROLES, FINANCE_ROLES, hasRole } from "@/lib/nav-config";
import { getInvoices } from "@/app/revenue-analysis/page";
import { getJobOrderOptions, getInvoiceHistory } from "@/app/revenue-analysis/invoice-entry/page";
import { DispatchTabs } from "./dispatch-tabs";
import type { DispatchOrderRow } from "./dispatch-client";

const DISPATCH_STATUSES = ["In Production", "At Warehouse"];

async function getDispatchOrders() {
  const supabase = await createClient();

  const { data } = await supabase
    .from("job_orders")
    .select(
      "id, job_order_no, customer_name, status, total_amount, deposit_amount, payment_terms, created_at"
    )
    .in("status", DISPATCH_STATUSES)
    .order("created_at", { ascending: true });

  return (data ?? []) as DispatchOrderRow[];
}

export default async function DispatchPage() {
  const user = await requireUser();
  const allowed = hasRole(user.role, [...ADMIN_ROLES, ...FINANCE_ROLES]);

  // Phase 4: Revenue Analysis / Invoice Entry (which itself bundles
  // Payment Recording from Phase 3.5) are reused as-is from their
  // standalone routes — this is the single, shared role gate for all
  // three tabs. Confirmed identical role sets before wiring anything
  // up (not assumed): Dispatch's own ADMIN_ROLES|FINANCE_ROLES gate
  // and job_invoices' RLS policies both resolve to exactly
  // {admin, manager, supervisor, md, fm, finance} — checked directly
  // against nav-config.ts and the live policy SQL, not inferred.
  //
  // getInvoices() (Revenue Analysis' lean query) and getInvoiceHistory()
  // (Invoice Entry's richer query) are two genuinely DIFFERENT queries
  // against job_invoices — different columns, different sort order —
  // not the same query called twice, so both are called here rather
  // than trying to force one fetch to serve both (that would be a new
  // consolidation this task didn't ask for, unlike Warehouse's
  // materials fetch reuse, which was the exact same query needed by
  // two tabs).
  const [orders, revenueInvoices, jobOrders, invoices] = allowed
    ? await Promise.all([getDispatchOrders(), getInvoices(), getJobOrderOptions(), getInvoiceHistory()])
    : [[], [], [], []];

  return (
    <AppShell userName={user.fullName} userRole={user.role} role={user.role}>
      <TopBar
        title="Appointed Time Printing Ltd."
        subtitle="Secured Capacity Planning Engine"
      />

      <div className="mb-2 text-lg font-bold text-at-navy-soft">Dispatch</div>

      {!allowed ? (
        <RestrictedAccess message="Dispatch is reserved for managers and administrators." />
      ) : (
        <DispatchTabs orders={orders} revenueInvoices={revenueInvoices} jobOrders={jobOrders} invoices={invoices} />
      )}
    </AppShell>
  );
}
