import { AppShell } from "@/components/shell/app-shell";
import { TopBar } from "@/components/shell/topbar";
import { MetricCard } from "@/components/ui/metric-card";

// TODO(supabase): replace with a real fetch mirroring app.py's
// get_approved_orders_cached() + get_db_jobs(). Shape kept 1:1 with the
// original KPI rows so the swap is a data-layer change only, not a
// layout change.
const mockKpis = {
  activeOrders: 42,
  contractValue: 184250.0,
  pressOrders: 27,
  garmentOrders: 15,
  bookRunsQueue: 6,
  packagingSkillets: 11,
  depositCollected: 96400.0,
  outstandingBalance: 87850.0,
};

const CURRENCY = "GH₵";

export default function CommandCenterPage() {
  const { activeOrders, contractValue, pressOrders, garmentOrders, bookRunsQueue, packagingSkillets, depositCollected, outstandingBalance } =
    mockKpis;

  return (
    <AppShell
      userName="demo@appointedtime.com.gh"
      userRole="Managing Director"
      role="md"
      pendingApprovalsCount={3}
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
