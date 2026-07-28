import { AppShell } from "@/components/shell/app-shell";
import { TopBar } from "@/components/shell/topbar";
import { MetricCard } from "@/components/ui/metric-card";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";

const CURRENCY = "GH₵";

// Statuses that count as "active" for get_approved_orders_cached()'s KPIs.
// Excludes 'Pending' (not yet approved) and 'Delivered'/'Ready for
// Collection' (those belong to get_archive_orders_cached() instead).
const ACTIVE_ORDER_STATUSES = ["Approved", "In Production", "At Warehouse"];

// Ports _is_garment() from app.py line 791.
const GARMENT_PRINT_TYPES = new Set([
  "DTF",
  "UV-DTF",
  "SAV",
  "EMBROIDERY",
  "FLEXI SCREEN PRINT",
]);

interface OrderRow {
  job_order_no: string | null;
  total_amount: number | null;
  deposit_amount: number | null;
  department: string | null;
  type_of_print: string | null;
  print_type: string | null;
}

interface JobRow {
  tracking_id: string | null;
  ups: number;
  finish_time: string | null;
}

function isGarment(row: OrderRow): boolean {
  if ((row.department ?? "").trim().toUpperCase() === "GARMENT") return true;
  const printType = (row.type_of_print || row.print_type || "").trim().toUpperCase();
  return GARMENT_PRINT_TYPES.has(printType);
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

  const [ordersRes, pendingRes, jobsRes] = await Promise.all([
    supabase
      .from("job_orders")
      .select("job_order_no, total_amount, deposit_amount, department, type_of_print, print_type")
      .in("status", ACTIVE_ORDER_STATUSES),
    supabase
      .from("job_orders")
      .select("id", { count: "exact", head: true })
      .eq("status", "Pending"),
    supabase
      .from("jobs")
      .select("tracking_id, ups, finish_time")
      .or(`finish_time.gte.${jobsWindowStart},finish_time.is.null`),
  ]);

  const orders = (ordersRes.data ?? []) as OrderRow[];
  const jobs = (jobsRes.data ?? []) as JobRow[];

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
    </AppShell>
  );
}
