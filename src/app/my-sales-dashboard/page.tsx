import Link from "next/link";
import { AppShell } from "@/components/shell/app-shell";
import { TopBar } from "@/components/shell/topbar";
import { RestrictedAccess } from "@/components/shell/restricted-access";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { getSalesReps } from "@/lib/sales-reps";
import {
  MySalesDashboardClient,
  SalesTeamOverview,
  type SalesJobOrderRow,
  type SalesInvoiceRow,
  type TeamJobOrderRow,
  type TeamInvoiceRow,
} from "./my-sales-dashboard-client";
import { RepSelector } from "./rep-selector";

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

const TEAM_JOB_ORDER_SELECT = "id, job_order_no, client_id, order_date, sales_rep";
const TEAM_INVOICE_SELECT = "id, date, job_order_no, client_id, sales_rep, invoice_total, payment, balance";

// Sales Team Overview (manager-only tab) — same two-query "unlinked +
// linked, deduped by id" shape as getMyJobOrders/getMyInvoices above,
// generalized from .eq(salesRepName) to .in(repNames) since this
// aggregates across every real rep at once instead of scoping to one.
// sales_rep is included in both selects so the client component can
// group each row by its OWNING rep (see TeamInvoiceRow's own comment
// for why a linked invoice's sales_rep is null and resolved via its
// job_order_no instead).
async function getTeamJobOrders(repNames: string[]): Promise<TeamJobOrderRow[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("job_orders").select(TEAM_JOB_ORDER_SELECT).in("sales_rep", repNames);
  return (data ?? []) as TeamJobOrderRow[];
}

async function getTeamInvoices(repNames: string[], allJobOrderNos: string[]): Promise<TeamInvoiceRow[]> {
  const supabase = await createClient();

  const unlinked = await supabase.from("job_invoices").select(TEAM_INVOICE_SELECT).in("sales_rep", repNames);

  const linked =
    allJobOrderNos.length > 0
      ? await supabase.from("job_invoices").select(TEAM_INVOICE_SELECT).in("job_order_no", allJobOrderNos)
      : { data: [] as TeamInvoiceRow[] };

  const byId = new Map<number, TeamInvoiceRow>();
  for (const row of [...(unlinked.data ?? []), ...(linked.data ?? [])] as TeamInvoiceRow[]) {
    byId.set(row.id, row);
  }
  return Array.from(byId.values());
}

export default async function MySalesDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ rep?: string; view?: string }>;
}) {
  const user = await requireUser();
  const { rep: repParam, view: viewParam } = await searchParams;

  // Manager-only: the real source of truth for who's selectable is the
  // SAME get_sales_reps() RPC the dropdown itself is sourced from (per
  // this task's own instruction) — never a second, possibly-drifted list.
  const salesReps = user.isSalesManager ? await getSalesReps() : [];
  const repNames = salesReps.map((r) => r.full_name);

  // Two tabs, manager-only — a plain rep has no `view` concept at all
  // and always gets the "own" experience unchanged. "team" is only ever
  // reachable by a manager; anyone else's ?view=team is silently ignored.
  const activeView: "own" | "team" = user.isSalesManager && viewParam === "team" ? "team" : "own";

  // Default selection: the manager's own name if they're also a sales
  // rep, otherwise the first rep in the list. A non-manager rep always
  // sees their own name regardless of anything in the URL — ?rep= is a
  // manager-only affordance, never a way for a plain rep to view someone
  // else's data.
  const defaultRepName = user.isSalesRep ? user.fullName : (repNames[0] ?? null);
  const scopedRepName = user.isSalesManager
    ? repParam && repNames.includes(repParam)
      ? repParam
      : defaultRepName
    : user.isSalesRep
      ? user.fullName
      : null;

  const canView = user.isSalesRep || user.isSalesManager;
  const viewingOwnData = scopedRepName === user.fullName;

  // Only fetch what the ACTIVE tab actually needs — switching tabs never
  // pays for the other tab's queries.
  const jobOrders = activeView === "own" && scopedRepName ? await getMyJobOrders(scopedRepName) : [];
  const invoices =
    activeView === "own" && scopedRepName
      ? await getMyInvoices(
          scopedRepName,
          jobOrders.map((o) => o.job_order_no)
        )
      : [];

  const teamJobOrders = activeView === "team" ? await getTeamJobOrders(repNames) : [];
  const teamInvoices =
    activeView === "team"
      ? await getTeamInvoices(
          repNames,
          teamJobOrders.map((o) => o.job_order_no)
        )
      : [];

  const tabClass = (active: boolean) =>
    `px-4 py-2.5 text-sm font-bold transition-colors ${
      active ? "border-b-2 border-at-navy text-at-navy" : "text-at-slate hover:text-at-navy"
    }`;

  return (
    <AppShell
      userName={user.fullName}
      userRole={user.role}
      role={user.role}
      isSalesRep={user.isSalesRep}
      isSalesManager={user.isSalesManager}
    >
      <TopBar title="Appointed Time Printing Ltd." subtitle="Secured Capacity Planning Engine" />

      <div className="mb-1 text-lg font-bold text-at-navy-soft">My Sales Dashboard</div>
      <div className="mb-4 text-sm text-at-slate">
        {activeView === "team"
          ? "Company-wide sales performance, one row per real sales rep."
          : viewingOwnData
            ? "Jobs and revenue attributed to you as sales/marketing rep."
            : `Jobs and revenue attributed to ${scopedRepName} as sales/marketing rep.`}
      </div>

      {!canView ? (
        <RestrictedAccess message="My Sales Dashboard is reserved for accounts flagged as sales reps or sales managers." />
      ) : (
        <>
          {/* Manager-only tab bar — same underline-tab convention as
              Archive/Dispatch/Warehouse's own tab bars, just Link-driven
              instead of local state, since both tabs' content is fetched
              server-side and switching tabs is a real navigation, not a
              client-side toggle. */}
          {user.isSalesManager && (
            <div className="mb-4 flex gap-1 border-b border-at-border">
              <Link href="/my-sales-dashboard" className={tabClass(activeView === "own")}>
                My Dashboard
              </Link>
              <Link href="/my-sales-dashboard?view=team" className={tabClass(activeView === "team")}>
                Sales Team Overview
              </Link>
            </div>
          )}

          {activeView === "team" ? (
            <SalesTeamOverview repNames={repNames} jobOrders={teamJobOrders} invoices={teamInvoices} />
          ) : !scopedRepName ? (
            <div className="rounded-at-lg border border-at-border bg-at-white p-6 text-sm text-at-slate shadow-at-sm">
              No sales reps are configured yet — nothing to show.
            </div>
          ) : (
            <>
              {/* Manager-only: re-renders the EXACT SAME dashboard below,
                  scoped to whichever rep is selected — no forked component,
                  just a different scopedRepName driving the same two
                  queries above. Navigates via a real ?rep= URL param (see
                  rep-selector.tsx), so switching reps is a genuine server
                  refetch, never client-side-only state. */}
              {user.isSalesManager && <RepSelector options={repNames} currentRep={scopedRepName} />}

              {/* MANDATORY, permanent, high-visibility caption — the most
              consequential one in this sweep (2026-08-30 revenue audit):
              a rep seeing a low number here with no explanation could
              reasonably think their own performance is being
              under-reported, when the real cause is a data-completeness
              gap that predates this field being required. Same amber
              callout-box style already used elsewhere for a "don't miss
              this" caveat (CategoryView's uncategorized-orders warning,
              command-center/charts.tsx) — not a new visual convention.

              Wording is contextual (2026-09-01, manager access): "your
              own performance" framing is only correct when this really
              is the viewer's own data. A manager who isn't also a sales
              rep never has "own" data here — every rep they can select
              is someone else's — so the caption is reframed in the third
              person for that case instead of misleadingly implying it's
              about the viewer. */}
              <div className="mb-4 rounded-at border border-at-warning bg-at-warning-bg px-4 py-2.5 text-xs font-semibold text-at-warning-text">
                {viewingOwnData ? (
                  <>
                    This only counts orders and invoices with your name recorded as Sales Rep.
                    Sales Rep became a required field on 2026-08-30 — before that date, many
                    orders and invoices were never tagged with any rep, so real work you brought
                    in earlier may not appear here. A low total isn&apos;t necessarily a
                    performance issue; it may just mean older records were never attributed to
                    anyone.
                  </>
                ) : (
                  <>
                    This only counts orders and invoices with {scopedRepName}&apos;s name recorded
                    as Sales Rep. Sales Rep became a required field on 2026-08-30 — before that
                    date, many orders and invoices were never tagged with any rep, so real work{" "}
                    {scopedRepName} brought in earlier may not appear here. A low total isn&apos;t
                    necessarily a reflection of {scopedRepName}&apos;s performance; it may just
                    mean older records were never attributed to anyone.
                  </>
                )}
              </div>
              <MySalesDashboardClient
                key={scopedRepName}
                repName={scopedRepName}
                jobOrders={jobOrders}
                invoices={invoices}
              />
            </>
          )}
        </>
      )}
    </AppShell>
  );
}
