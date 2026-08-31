import { AppShell } from "@/components/shell/app-shell";
import { TopBar } from "@/components/shell/topbar";
import { MetricCard } from "@/components/ui/metric-card";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { isGarment, type GarmentClassifiable } from "@/lib/is-garment";
import { getInvoicePaymentSumsByOrderNo, withEffectiveDeposits } from "@/lib/effective-deposit";
import {
  TrendCharts,
  CapacityCharts,
  OrderIntakeChart,
  DepartmentalPerformanceCharts,
  InfoPopover,
  type TrendOrderRow,
  type CapacityJobRow,
  type DeptPerformanceRow,
} from "./charts";

const CURRENCY = "GH₵";

// Statuses that count as "active" for get_approved_orders_cached()'s KPIs.
// Excludes 'Pending' (not yet approved) and 'Delivered'/'Ready for
// Collection' (those belong to get_archive_orders_cached() instead).
const ACTIVE_ORDER_STATUSES = ["Approved", "In Production", "At Warehouse"];

// Same 5-status set Archive uses (src/app/archive/page.tsx's
// ARCHIVE_STATUSES, get_archive_orders_cached's equivalent) — NOT
// exported there, so replicated exactly rather than reused. Deliberately
// broader than ACTIVE_ORDER_STATUSES above: Departmental Performance
// represents total historical actuals for reporting (including
// completed/delivered orders), not "current active work." Verified
// live before building: this scope's total revenue (GH₵787,682.00,
// 33 rows) is a strict superset of the 3-status KPI's total
// (GH₵776,710.00, 21 rows) — the ~GH₵11k difference is fully explained
// by the 12 additional Delivered rows, not a bug.
const DEPT_PERFORMANCE_STATUSES = [
  "Approved",
  "In Production",
  "At Warehouse",
  "Ready for Collection",
  "Delivered",
];

// Matches Authorization Center's own PENDING_STATUSES (src/app/authorization/
// page.tsx) — the real statuses a pending order can have. Previously this
// queried status = 'Pending', a value no real row ever has, so this KPI (and
// the sidebar badge it feeds) always silently read 0.
const PENDING_STATUSES = ["Pending Approval", "Pending Revision Approval"];

interface OrderRow extends GarmentClassifiable {
  id: number;
  job_order_no: string | null;
  total_amount: number | null;
  deposit_amount: number | null;
  created_at: string | null;
  date_of_collection: string | null;
  // Added for the KPI redesign's WIP tile (2026-08-31) — needs to isolate
  // In Production rows from the rest of the already-fetched Active
  // population, not a second query.
  status: string | null;
}

function money(n: number): string {
  return `${CURRENCY}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Ports app.py's C8a overdue-collection-alert trigger, scoped to the
// OVERDUE branch only (days_remaining < 0) — the sibling "due in N
// days" reminder and the warehouse-aging alert aren't built here, not
// requested. Unlike the source (Streamlit st.session_state — scoped to
// one browser tab, resets on every refresh, so the same order can and
// does re-alert repeatedly in the real system), the dedup here is a
// real DB column + an atomic conditional UPDATE on the backend — see
// backend/app/email.py's handle_overdue_alert for the actual
// claim-then-send logic and why it can't double-fire.
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL;

function daysRemaining(dateOfCollection: string): number {
  const collection = new Date(`${dateOfCollection}T00:00:00Z`);
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((collection.getTime() - todayUtc) / (24 * 60 * 60 * 1000));
}

// Identifies candidates from data getKpis() already fetched (pure read),
// then hands each one to the backend — the actual dedup claim and the
// email send both happen there, not as a write from this Server
// Component. A failed request here is logged and swallowed so a backend
// hiccup never breaks the Command Center page load.
async function triggerOverdueCollectionAlerts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orders: OrderRow[]
) {
  if (!BACKEND_URL) return;

  const candidates = orders.filter((row) => {
    if (!row.date_of_collection) return false;
    const balance = Number(row.total_amount ?? 0) - Number(row.deposit_amount ?? 0);
    return balance > 0 && daysRemaining(row.date_of_collection) < 0;
  });
  if (candidates.length === 0) return;

  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) return;

  await Promise.all(
    candidates.map((row) =>
      fetch(`${BACKEND_URL}/email/collection-overdue`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ order_id: row.id }),
      }).catch((err) => {
        console.error("Overdue collection alert request failed for order", row.id, err);
      })
    )
  );
}

interface JobRow {
  tracking_id: string | null;
  ups: number;
  finish_time: string | null;
  machine: string;
  job_name: string;
  contract_value: number | null;
}

// Mirrors pandas' Series.nunique(): counts distinct non-null values.
function nunique(values: (string | null)[]): number {
  const set = new Set<string>();
  for (const value of values) {
    if (value) set.add(value);
  }
  return set.size;
}

async function getKpis() {
  const supabase = await createClient();

  const jobsWindowStart = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();

  // Trend charts need a broader, date-bounded (not status-filtered) fetch —
  // 365 days covers both the Weekly (180d) and Monthly (365d) toggle states,
  // so switching periods client-side never needs a second round-trip.
  const trendCutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();

  const [ordersRes, pendingRes, jobsRes, trendRes, deptPerformanceRes] = await Promise.all([
    supabase
      .from("job_orders")
      .select(
        "id, job_order_no, total_amount, deposit_amount, department, type_of_print, print_type, created_at, date_of_collection, status"
      )
      .in("status", ACTIVE_ORDER_STATUSES),
    supabase
      .from("job_orders")
      .select("id", { count: "exact", head: true })
      .in("status", PENDING_STATUSES),
    supabase
      .from("jobs")
      .select("tracking_id, ups, finish_time, machine, job_name, contract_value")
      .or(`finish_time.gte.${jobsWindowStart},finish_time.is.null`),
    supabase
      .from("job_orders")
      .select("created_at, job_order_no, total_amount, deposit_amount, status")
      .gte("created_at", trendCutoff),
    supabase
      .from("job_orders")
      .select("job_order_no, total_amount, deposit_amount, department, type_of_print, print_type, order_date")
      .in("status", DEPT_PERFORMANCE_STATUSES),
  ]);

  // Deposit-sync fix, Phase 1 (2026-08-31): for a linked order,
  // deposit_amount here is replaced with the real SUM of its linked
  // invoice(s)' payment — computed once, applied to all three queries
  // above, so every KPI/chart on this page reads the same corrected
  // figure rather than the stale, independently-drifting column value.
  const invoicePaymentSums = await getInvoicePaymentSumsByOrderNo(supabase);

  const orders = withEffectiveDeposits((ordersRes.data ?? []) as OrderRow[], invoicePaymentSums);
  const jobs = (jobsRes.data ?? []) as JobRow[];
  const trendRows = withEffectiveDeposits(
    (trendRes.data ?? []) as TrendOrderRow[],
    invoicePaymentSums
  );
  const deptPerformanceRows = withEffectiveDeposits(
    (deptPerformanceRes.data ?? []) as DeptPerformanceRow[],
    invoicePaymentSums
  );

  await triggerOverdueCollectionAlerts(supabase, orders);

  // KPI redesign (2026-08-31) — confirmed definitions:
  //
  // Active Orders / WIP value come from `orders` (the existing
  // ACTIVE_ORDER_STATUSES/3-status fetch) — unchanged scope for Active,
  // WIP is a filter of that SAME already-fetched set down to In
  // Production only, not a second query.
  const wipOrders = orders.filter((row) => row.status === "In Production");
  const activeOrdersValue = orders.reduce((sum, row) => sum + Number(row.total_amount ?? 0), 0);
  const wipValue = wipOrders.reduce((sum, row) => sum + Number(row.total_amount ?? 0), 0);

  // Total Revenue / Collections / Outstanding all come from
  // `deptPerformanceRows` — the SAME Approved-and-beyond (5-status)
  // population Departmental Performance itself uses, already carrying
  // the Phase 1 effective-deposit correction. No new query, no second
  // calculation: Collections is exactly deptPerformanceRows' own
  // (already-corrected) deposit_amount, summed — the identical
  // mechanism that already correctly combines an order-time deposit
  // with a later Invoice Entry payment for a linked order. Outstanding
  // is derived from these same two sums, not queried separately, so it
  // can never disagree with Total Revenue - Collections by so much as
  // a rounding unit.
  const totalRevenue = deptPerformanceRows.reduce((sum, row) => sum + Number(row.total_amount ?? 0), 0);
  const collections = deptPerformanceRows.reduce((sum, row) => sum + Number(row.deposit_amount ?? 0), 0);
  const outstanding = totalRevenue - collections;

  // Press/Garment value (2026-08-31 KPI restructure) — same `orders` array
  // already fetched for the counts above (3-status Active scope), just
  // reduced to a contract-value sum per department. No new query.
  const pressOrderRows = orders.filter((row) => !isGarment(row));
  const garmentOrderRows = orders.filter(isGarment);
  const pressOrdersValue = pressOrderRows.reduce((sum, row) => sum + Number(row.total_amount ?? 0), 0);
  const garmentOrdersValue = garmentOrderRows.reduce((sum, row) => sum + Number(row.total_amount ?? 0), 0);

  return {
    activeOrdersCount: nunique(orders.map((row) => row.job_order_no)),
    activeOrdersValue,
    wipCount: nunique(wipOrders.map((row) => row.job_order_no)),
    wipValue,
    totalRevenue,
    collections,
    outstanding,
    pressOrders: nunique(pressOrderRows.map((row) => row.job_order_no)),
    pressOrdersValue,
    garmentOrders: nunique(garmentOrderRows.map((row) => row.job_order_no)),
    garmentOrdersValue,
    pendingApprovals: pendingRes.count ?? 0,
    orders,
    jobs: jobs as CapacityJobRow[],
    trendRows,
    deptPerformanceRows,
  };
}

export default async function CommandCenterPage() {
  const user = await requireUser();

  const {
    activeOrdersCount,
    activeOrdersValue,
    wipCount,
    wipValue,
    totalRevenue,
    collections,
    outstanding,
    pressOrders,
    pressOrdersValue,
    garmentOrders,
    garmentOrdersValue,
    pendingApprovals,
    orders,
    jobs,
    trendRows,
    deptPerformanceRows,
  } = await getKpis();

  return (
    <AppShell
      userName={user.fullName}
      userRole={user.role}
      role={user.role}
      isSalesRep={user.isSalesRep}
      pendingApprovalsCount={pendingApprovals}
    >
      <TopBar
        title="Appointed Time Printing Ltd."
        subtitle="Secured Capacity Planning Engine"
      />

      <div className="mb-2 text-lg font-bold text-at-navy-soft">Command Center</div>

      {/* KPI grid (2026-08-31 restructure, replacing the grouped/labeled
          rows) — Total Revenue is a single grid item spanning all 3 rows
          in column 1, vertically centered; the other 6 tiles fill columns
          2-3 in DOM order. On sm+ this relies on CSS Grid's own
          row-major auto-placement: Total Revenue claims column 1 for all
          3 rows first, so the 6 plain-flow items that follow it in the
          markup are auto-packed into columns 2-3 across exactly 3 rows —
          no explicit grid-row/grid-column needed on any of them. Below
          sm, Total Revenue instead spans both columns of a plain 2-col
          grid (full-width on its own row), and the same 6 items auto-flow
          into a 2-column block underneath it. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="col-span-2 sm:col-span-1 sm:row-span-3 sm:grid sm:items-center">
          <MetricCard
            label={
              <>
                Total Revenue
                <InfoPopover>
                  <p>All Approved-and-beyond orders, including completed/delivered ones.</p>
                </InfoPopover>
              </>
            }
            value={money(totalRevenue)}
            valueClassName="text-[2rem]"
            dense
          />
        </div>

        <MetricCard
          label={
            <>
              Active Orders
              <InfoPopover>
                <p>
                  Counts only Approved, In Production, and At Warehouse orders — completed/
                  delivered orders are excluded, which is why this total is smaller than
                  Departmental Performance below.
                </p>
              </InfoPopover>
            </>
          }
          value={activeOrdersCount}
          subValue={money(activeOrdersValue)}
          dense
        />
        <MetricCard
          label="Press Orders"
          value={pressOrders}
          subValue={money(pressOrdersValue)}
          accentColor="#0369a1"
          dense
        />

        <MetricCard
          label={
            <>
              WIP
              <InfoPopover>
                <p>
                  Orders currently In Production only — does not include Approved (not yet
                  started) or At Warehouse (production finished).
                </p>
              </InfoPopover>
            </>
          }
          value={wipCount}
          subValue={money(wipValue)}
          accentColor="#0369a1"
          dense
        />
        <MetricCard
          label="Garment Orders"
          value={garmentOrders}
          subValue={money(garmentOrdersValue)}
          accentColor="#d97706"
          dense
        />

        <MetricCard
          label={
            <>
              Collections
              <InfoPopover>
                <p>
                  Includes deposits recorded at order-raise time AND payments recorded later
                  through Invoice Entry for linked invoices — combined correctly, not
                  double-counted.
                </p>
              </InfoPopover>
            </>
          }
          value={money(collections)}
          accentColor="#10b981"
          dense
        />
        <MetricCard
          label={
            <>
              Outstanding Receivables
              <InfoPopover>
                <p>Total Revenue minus Collections.</p>
              </InfoPopover>
            </>
          }
          value={money(outstanding)}
          accentColor="#ef4444"
          dense
        />
      </div>

      <TrendCharts rows={trendRows} />
      <CapacityCharts jobs={jobs} />
      <OrderIntakeChart orders={orders} />
      <DepartmentalPerformanceCharts rows={deptPerformanceRows} />
    </AppShell>
  );
}
