import { AppShell } from "@/components/shell/app-shell";
import { TopBar } from "@/components/shell/topbar";
import { MetricCard } from "@/components/ui/metric-card";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { isGarment, type GarmentClassifiable } from "@/lib/is-garment";
import {
  TrendCharts,
  CapacityCharts,
  OrderIntakeChart,
  DepartmentalPerformanceCharts,
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
        "id, job_order_no, total_amount, deposit_amount, department, type_of_print, print_type, created_at, date_of_collection"
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
      .select("created_at, job_order_no, total_amount, deposit_amount")
      .gte("created_at", trendCutoff),
    supabase
      .from("job_orders")
      .select("job_order_no, total_amount, deposit_amount, department, type_of_print, print_type")
      .in("status", DEPT_PERFORMANCE_STATUSES),
  ]);

  const orders = (ordersRes.data ?? []) as OrderRow[];
  const jobs = (jobsRes.data ?? []) as JobRow[];
  const trendRows = (trendRes.data ?? []) as TrendOrderRow[];
  const deptPerformanceRows = (deptPerformanceRes.data ?? []) as DeptPerformanceRow[];

  await triggerOverdueCollectionAlerts(supabase, orders);

  const contractValue = orders.reduce((sum, row) => sum + Number(row.total_amount ?? 0), 0);
  const depositCollected = orders.reduce((sum, row) => sum + Number(row.deposit_amount ?? 0), 0);

  return {
    activeOrders: nunique(orders.map((row) => row.job_order_no)),
    contractValue,
    pressOrders: nunique(orders.filter((row) => !isGarment(row)).map((row) => row.job_order_no)),
    garmentOrders: nunique(orders.filter(isGarment).map((row) => row.job_order_no)),
    bookRunsQueue: nunique(jobs.filter((job) => job.ups === 1).map((job) => job.tracking_id)),
    packagingSkillets: nunique(jobs.filter((job) => job.ups > 1).map((job) => job.tracking_id)),
    depositCollected,
    outstandingBalance: contractValue - depositCollected,
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
    activeOrders,
    contractValue,
    pressOrders,
    garmentOrders,
    bookRunsQueue,
    packagingSkillets,
    depositCollected,
    outstandingBalance,
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
      pendingApprovalsCount={pendingApprovals}
    >
      <TopBar
        title="Appointed Time Printing Ltd."
        subtitle="Secured Capacity Planning Engine"
      />

      <div className="mb-2 text-lg font-bold text-at-navy-soft">Command Center</div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <MetricCard label="Active Orders (All)" value={activeOrders} />
        <MetricCard
          label="Contract Value"
          value={`${CURRENCY}${contractValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
          valueClassName="text-[1.35rem]"
        />
        <MetricCard label="Press Orders" value={pressOrders} accentColor="#0369a1" />
        <MetricCard label="Garment Orders" value={garmentOrders} accentColor="#d97706" />
        <MetricCard label="Book Runs Queue" value={bookRunsQueue} />
        <MetricCard label="Packaging Skillets" value={packagingSkillets} />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard
          label="Deposits Collected"
          value={`${CURRENCY}${depositCollected.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
          accentColor="#10b981"
        />
        <MetricCard
          label="Outstanding Receivables"
          value={`${CURRENCY}${outstandingBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
          accentColor="#ef4444"
        />
        <MetricCard
          label="Total Contract Value"
          value={`${CURRENCY}${contractValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
        />
      </div>

      <TrendCharts rows={trendRows} />
      <CapacityCharts jobs={jobs} />
      <OrderIntakeChart orders={orders} />
      <DepartmentalPerformanceCharts rows={deptPerformanceRows} />
    </AppShell>
  );
}
