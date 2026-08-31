import { AppShell } from "@/components/shell/app-shell";
import { TopBar } from "@/components/shell/topbar";
import { RestrictedAccess } from "@/components/shell/restricted-access";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { MySalesDashboardClient, type SalesJobOrderRow, type SalesInvoiceRow } from "./my-sales-dashboard-client";

// Phase 4a's confirmed, verified finding (not assumed here — see
// MIGRATION_STATUS.md / that phase's own report): job_orders' SELECT
// RLS is open to every authenticated role, full stop. The new
// sales-rep-scoped policy built in that phase is real but currently a
// no-op there (permissive policies only ever ADD access on top of an
// already-open one). This .eq("sales_rep", ...) filter is therefore
// the ONLY thing scoping this query to the rep's own rows — RLS does
// none of that work for job_orders. Do not remove this filter on the
// assumption RLS already covers it.
async function getMyJobOrders(salesRepName: string): Promise<SalesJobOrderRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("job_orders")
    .select("id, job_order_no, client_id, order_date")
    .eq("sales_rep", salesRepName);
  return (data ?? []) as SalesJobOrderRow[];
}

const INVOICE_SELECT =
  "id, date, job_order_no, customer_name, client_id, revenue_category, business_unit, quantity, unit_price, invoice_total, payment, balance, status, oracle_no, clients(name)";

// job_invoices genuinely IS RLS-scoped for a sales rep now (Phase 4a's
// "sales rep can view own attributed job invoices" policy) — unlike
// job_orders above, an unfiltered select here would already come back
// correctly scoped. Filtered explicitly anyway, as defense-in-depth:
// this query's own intent stays self-evident without relying on an
// invisible policy defined elsewhere, and it costs nothing extra
// (PostgREST needs a WHERE clause either way). Two separate queries
// (direct sales_rep match for unlinked entries, job_order_no IN (...)
// for order-linked ones) merged and deduped by id client-side, rather
// than one combined .or() filter string — avoids hand-escaping a real
// person's full name inside a PostgREST filter expression.
async function getMyInvoices(salesRepName: string, myJobOrderNos: string[]): Promise<SalesInvoiceRow[]> {
  const supabase = await createClient();

  const unlinked = await supabase.from("job_invoices").select(INVOICE_SELECT).eq("sales_rep", salesRepName);

  const linked =
    myJobOrderNos.length > 0
      ? await supabase.from("job_invoices").select(INVOICE_SELECT).in("job_order_no", myJobOrderNos)
      : { data: [] as SalesInvoiceRow[] };

  const byId = new Map<number, SalesInvoiceRow>();
  for (const row of [...(unlinked.data ?? []), ...(linked.data ?? [])] as SalesInvoiceRow[]) {
    byId.set(row.id, row);
  }
  return Array.from(byId.values());
}

export default async function MySalesDashboardPage() {
  const user = await requireUser();

  const jobOrders = user.isSalesRep ? await getMyJobOrders(user.fullName) : [];
  const invoices = user.isSalesRep
    ? await getMyInvoices(
        user.fullName,
        jobOrders.map((o) => o.job_order_no)
      )
    : [];

  return (
    <AppShell userName={user.fullName} userRole={user.role} role={user.role} isSalesRep={user.isSalesRep}>
      <TopBar title="Appointed Time Printing Ltd." subtitle="Secured Capacity Planning Engine" />

      <div className="mb-1 text-lg font-bold text-at-navy-soft">My Sales Dashboard</div>
      <div className="mb-4 text-sm text-at-slate">
        Jobs and revenue attributed to you as sales/marketing rep.
      </div>

      {!user.isSalesRep ? (
        <RestrictedAccess message="My Sales Dashboard is reserved for accounts flagged as sales reps." />
      ) : (
        <>
          {/* MANDATORY, permanent, high-visibility caption — the most
              consequential one in this sweep (2026-08-30 revenue audit):
              a rep seeing a low number here with no explanation could
              reasonably think their own performance is being
              under-reported, when the real cause is a data-completeness
              gap that predates this field being required. Same amber
              callout-box style already used elsewhere for a "don't miss
              this" caveat (CategoryView's uncategorized-orders warning,
              command-center/charts.tsx) — not a new visual convention. */}
          <div className="mb-4 rounded-at border border-at-warning bg-at-warning-bg px-4 py-2.5 text-xs font-semibold text-at-warning-text">
            This only counts orders and invoices with your name recorded as Sales Rep. Sales Rep
            became a required field on 2026-08-30 — before that date, many orders and invoices
            were never tagged with any rep, so real work you brought in earlier may not appear
            here. A low total isn&apos;t necessarily a performance issue; it may just mean older
            records were never attributed to anyone.
          </div>
          <MySalesDashboardClient repName={user.fullName} jobOrders={jobOrders} invoices={invoices} />
        </>
      )}
    </AppShell>
  );
}
