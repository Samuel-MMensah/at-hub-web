"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Area,
  AreaChart,
} from "recharts";
import { weekStart } from "@/lib/week-groups";
import { isGarment, type GarmentClassifiable } from "@/lib/is-garment";
import {
  orderCategory,
  ORDER_CATEGORIES,
  GARMENT_CATEGORIES,
  PRESS_CATEGORIES,
  type OrderCategory,
} from "@/lib/order-category";
import { DonutChart } from "@/components/ui/donut-chart";
import { Button } from "@/components/ui/button";

const CURRENCY = "GH₵";

// Validated via dataviz skill's validate_palette.js against this app's
// white card surface (#ffffff, light mode) — 6 slots, all hard gates
// pass; 3 slots (aqua/yellow/magenta) fall under the WARN contrast band,
// which requires visible labels rather than color alone — the donut
// chart below always shows a legend + slice labels, not color-only.
const CATEGORICAL_PALETTE = [
  "#2a78d6", // blue
  "#eb6834", // orange
  "#1baf7a", // aqua
  "#eda100", // yellow
  "#e87ba4", // magenta
  "#008300", // green
];
const OTHER_COLOR = "#94a3b8"; // at-slate-light — neutral, not a categorical hue

const AXIS_TICK_STYLE = { fill: "#64748b", fontSize: 12 };
const GRID_COLOR = "#f1f5f9";
const BORDER_COLOR = "#e2e8f0";

function money(n: number, fractionDigits = 0): string {
  return `${CURRENCY}${n.toLocaleString(undefined, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })}`;
}

function ChartTooltip({
  active,
  label,
  payload,
  valueFormatter = (v: number) => money(v, 2),
}: {
  active?: boolean;
  label?: string;
  payload?: { name: string; value: number; color: string }[];
  /** Defaults to money(v, 2) — the "Jobs" donut passes a plain integer
   * formatter instead, since a job count isn't currency. */
  valueFormatter?: (v: number) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-at border border-at-border bg-at-white px-3 py-2 shadow-at-md">
      {label && <div className="mb-1 text-xs font-bold text-at-slate">{label}</div>}
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center gap-2 text-xs">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-at-slate">{entry.name}:</span>
          <span className="font-bold text-at-navy">{valueFormatter(entry.value)}</span>
        </div>
      ))}
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return <div className="mb-3 mt-8 text-lg font-bold text-at-navy-soft">{children}</div>;
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-at-lg border border-at-border bg-at-white p-6 text-sm text-at-slate shadow-at-sm">
      {children}
    </div>
  );
}

/* ── Trend — Jobs, Revenue & Collections ──────────────────────────── */

export interface TrendOrderRow {
  created_at: string | null;
  job_order_no: string | null;
  total_amount: number | null;
  deposit_amount: number | null;
}

type TrendPeriod = "Weekly" | "Monthly";

function monthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function formatPeriodLabel(date: Date, period: TrendPeriod): string {
  if (period === "Monthly") {
    return date.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
  }
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

function groupTrend(rows: TrendOrderRow[], period: TrendPeriod) {
  const lookbackDays = period === "Weekly" ? 180 : 365;
  const cutoff = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;

  const buckets = new Map<
    string,
    { period: Date; jobOrderNos: Set<string>; revenue: number; collections: number }
  >();

  for (const row of rows) {
    if (!row.created_at) continue;
    const created = new Date(row.created_at);
    if (Number.isNaN(created.getTime()) || created.getTime() < cutoff) continue;

    const bucketDate = period === "Weekly" ? weekStart(created) : monthStart(created);
    const key = bucketDate.toISOString();

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { period: bucketDate, jobOrderNos: new Set(), revenue: 0, collections: 0 };
      buckets.set(key, bucket);
    }
    if (row.job_order_no) bucket.jobOrderNos.add(row.job_order_no);
    bucket.revenue += Number(row.total_amount ?? 0);
    bucket.collections += Number(row.deposit_amount ?? 0);
  }

  return Array.from(buckets.values())
    .sort((a, b) => a.period.getTime() - b.period.getTime())
    .map((b) => ({
      label: formatPeriodLabel(b.period, period),
      jobs: b.jobOrderNos.size,
      revenue: b.revenue,
      collections: b.collections,
    }));
}

export function TrendCharts({ rows }: { rows: TrendOrderRow[] }) {
  const [period, setPeriod] = useState<TrendPeriod>("Weekly");
  const grouped = useMemo(() => groupTrend(rows, period), [rows, period]);
  const lookbackDays = period === "Weekly" ? 180 : 365;

  return (
    <div>
      <SectionHeader>Trend — Jobs, Revenue &amp; Collections</SectionHeader>

      {/* MANDATORY, permanent caption — not a tooltip. Flipped from a
          popover per explicit instruction: this is one of the two
          captions on this page that explains a large, potentially
          confusing gap against Departmental Performance below, so it
          needs to be visible without a click. */}
      <div className="mb-3 text-xs text-at-slate">
        Includes every order raised in this window, regardless of status — Rejected orders are
        counted here too. Fixed to the last 180 days (Weekly) or 365 days (Monthly); there&apos;s
        no way to pick a different date range yet.
      </div>

      <div className="mb-4 flex gap-2">
        {(["Weekly", "Monthly"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setPeriod(option)}
            className={`rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors ${
              period === option
                ? "border-at-navy bg-at-navy text-at-white"
                : "border-at-border bg-at-white text-at-slate hover:border-at-accent"
            }`}
          >
            {option}
          </button>
        ))}
      </div>

      {grouped.length === 0 ? (
        <EmptyState>No orders raised in the last {lookbackDays} days yet.</EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <div className="rounded-at-lg border border-at-border bg-at-white p-4 shadow-at-sm lg:col-span-3">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={grouped} barGap={4}>
                <CartesianGrid stroke={GRID_COLOR} vertical={false} />
                <XAxis dataKey="label" tick={AXIS_TICK_STYLE} axisLine={{ stroke: BORDER_COLOR }} tickLine={false} />
                <YAxis
                  tick={AXIS_TICK_STYLE}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => money(v)}
                  width={80}
                />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: "#f8fafc" }} />
                <Legend
                  verticalAlign="top"
                  align="left"
                  height={32}
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: 12, color: "#64748b" }}
                />
                <Bar dataKey="revenue" name="Revenue" fill="#0369a1" radius={[4, 4, 0, 0]} maxBarSize={28} />
                <Bar dataKey="collections" name="Collections" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="rounded-at-lg border border-at-border bg-at-white p-4 shadow-at-sm lg:col-span-2">
            <div className="mb-1 text-xs font-bold uppercase tracking-wide text-at-slate">
              Jobs Raised
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={grouped}>
                <CartesianGrid stroke={GRID_COLOR} vertical={false} />
                <XAxis dataKey="label" tick={AXIS_TICK_STYLE} axisLine={{ stroke: BORDER_COLOR }} tickLine={false} />
                <YAxis tick={AXIS_TICK_STYLE} axisLine={false} tickLine={false} width={30} allowDecimals={false} />
                <Tooltip content={<ChartTooltip valueFormatter={(v) => v.toLocaleString()} />} />
                <Line
                  type="monotone"
                  dataKey="jobs"
                  name="Jobs Raised"
                  stroke="#0f172a"
                  strokeWidth={2}
                  dot={{ r: 4, fill: "#0f172a" }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Strategic Capacity Distribution & Revenue ────────────────────── */

export interface CapacityJobRow {
  machine: string;
  job_name: string;
  contract_value: number | null;
}

function groupMachineLoad(jobs: CapacityJobRow[]) {
  const counts = new Map<string, number>();
  for (const job of jobs) {
    counts.set(job.machine, (counts.get(job.machine) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([machine, count]) => ({ machine, count }))
    .sort((a, b) => a.machine.localeCompare(b.machine));
}

function groupJobNameRevenue(jobs: CapacityJobRow[]) {
  const totals = new Map<string, number>();
  for (const job of jobs) {
    const name = job.job_name || "—";
    totals.set(name, (totals.get(name) ?? 0) + Number(job.contract_value ?? 0));
  }
  const sorted = Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, CATEGORICAL_PALETTE.length);
  const rest = sorted.slice(CATEGORICAL_PALETTE.length);

  const result = top.map(([name, value], i) => ({
    name,
    value,
    color: CATEGORICAL_PALETTE[i],
  }));

  if (rest.length > 0) {
    result.push({
      name: "Other",
      value: rest.reduce((sum, [, v]) => sum + v, 0),
      color: OTHER_COLOR,
    });
  }

  return result;
}

export function CapacityCharts({ jobs }: { jobs: CapacityJobRow[] }) {
  const machineLoad = useMemo(() => groupMachineLoad(jobs), [jobs]);
  const jobNameRevenue = useMemo(() => groupJobNameRevenue(jobs), [jobs]);

  if (jobs.length === 0) return null;

  return (
    <div>
      <SectionHeader>Strategic Capacity Distribution &amp; Revenue</SectionHeader>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-at-lg border border-at-border bg-at-white p-4 shadow-at-sm lg:col-span-2">
          <div className="mb-1 text-xs font-bold uppercase tracking-wide text-at-slate">
            Allocated Components
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={machineLoad}>
              <CartesianGrid stroke={GRID_COLOR} vertical={false} />
              <XAxis dataKey="machine" tick={AXIS_TICK_STYLE} axisLine={{ stroke: BORDER_COLOR }} tickLine={false} />
              <YAxis tick={AXIS_TICK_STYLE} axisLine={false} tickLine={false} width={30} allowDecimals={false} />
              <Tooltip
                content={<ChartTooltip valueFormatter={(v) => v.toLocaleString()} />}
                cursor={{ fill: "#f8fafc" }}
              />
              <Bar dataKey="count" name="Allocated Components" fill="#0369a1" radius={[4, 4, 0, 0]} maxBarSize={40} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-at-lg border border-at-border bg-at-white p-4 shadow-at-sm">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wide text-at-slate">
              Revenue by Job
            </span>
            <InfoPopover>
              <p>
                This comes from the jobs table (shop-floor production scheduling) — it is not
                order or invoice revenue. It&apos;s also scoped to jobs finishing within the last
                72 hours or not yet finished, not all jobs company-wide.
              </p>
            </InfoPopover>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie
                data={jobNameRevenue}
                dataKey="value"
                nameKey="name"
                innerRadius="55%"
                outerRadius="80%"
                paddingAngle={2}
                label={({ percent }: { percent?: number }) =>
                  percent ? `${(percent * 100).toFixed(0)}%` : ""
                }
                labelLine={false}
              >
                {jobNameRevenue.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} stroke="#ffffff" strokeWidth={2} />
                ))}
              </Pie>
              <Tooltip content={<ChartTooltip />} />
              <Legend
                verticalAlign="bottom"
                iconType="circle"
                iconSize={8}
                wrapperStyle={{ fontSize: 11, color: "#64748b" }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

/* ── Order Intake Trend — Daily Contract Value ────────────────────── */

export interface IntakeOrderRow {
  created_at: string | null;
  total_amount: number | null;
}

function groupDailyIntake(rows: IntakeOrderRow[]) {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (!row.created_at) continue;
    const created = new Date(row.created_at);
    if (Number.isNaN(created.getTime())) continue;
    const dayKey = created.toISOString().slice(0, 10); // calendar day, UTC
    totals.set(dayKey, (totals.get(dayKey) ?? 0) + Number(row.total_amount ?? 0));
  }
  return Array.from(totals.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, value]) => ({
      label: new Date(day).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }),
      value,
    }));
}

export function OrderIntakeChart({ orders }: { orders: IntakeOrderRow[] }) {
  const daily = useMemo(() => groupDailyIntake(orders), [orders]);

  // Matches the original: a single point isn't a trend line, so this
  // section renders nothing at all (not even an empty-state message)
  // when there's one day of data or fewer.
  if (daily.length <= 1) return null;

  return (
    <div>
      <div className="mb-3 mt-8 flex items-center gap-2">
        <span className="text-lg font-bold text-at-navy-soft">Order Intake Trend — Daily Contract Value</span>
        <InfoPopover>
          <p>
            Same Approved/In Production/At Warehouse orders as the KPI cards above, plotted by the
            day each was raised — not a company-wide, all-status view.
          </p>
        </InfoPopover>
      </div>
      <div className="rounded-at-lg border border-at-border bg-at-white p-4 shadow-at-sm">
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={daily}>
            <CartesianGrid stroke={GRID_COLOR} vertical={false} />
            <XAxis dataKey="label" tick={AXIS_TICK_STYLE} axisLine={false} tickLine={false} />
            <YAxis
              tick={AXIS_TICK_STYLE}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => money(v)}
              width={90}
            />
            <Tooltip content={<ChartTooltip />} />
            <Area
              type="monotone"
              dataKey="value"
              name="Contract Value"
              stroke="#0369a1"
              strokeWidth={2.5}
              fill="#0369a1"
              fillOpacity={0.12}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* ── Departmental Performance ──────────────────────────────────────── */

export interface DeptPerformanceRow extends GarmentClassifiable {
  job_order_no: string | null;
  total_amount: number | null;
  deposit_amount: number | null;
  // "Date raised" — a plain Postgres DATE ("YYYY-MM-DD"), same format
  // <input type="date"> produces, so the range filter below is a
  // straight string comparison, no timezone conversion involved.
  order_date: string | null;
}

// Same two colors already established on Command Center's own KPI
// cards (Press/Garment Orders) — deliberately not a new pair.
const DEPT_COLORS = { Press: "#0369a1", Garment: "#d97706" } as const;

function nuniqueLocal(values: (string | null)[]): number {
  const set = new Set<string>();
  for (const v of values) {
    if (v) set.add(v);
  }
  return set.size;
}

interface DeptStats {
  label: "Press" | "Garment";
  revenue: number;
  jobs: number;
  collections: number;
  outstanding: number;
  color: string;
}

// isGarment() (src/lib/is-garment.ts) is the ONLY classification logic
// used here — not reimplemented. Revenue/Collections are raw sums;
// Outstanding is computed (Revenue - Collections), never queried —
// deposit_amount is already the cumulative collected-to-date figure
// (kept current by every Record Payment action across Dispatch and
// Archive), not just an initial deposit, so no new tracking is needed.
function groupDepartmentPerformance(rows: DeptPerformanceRow[]): DeptStats[] {
  const press = rows.filter((r) => !isGarment(r));
  const garment = rows.filter(isGarment);

  const build = (label: "Press" | "Garment", group: DeptPerformanceRow[]): DeptStats => {
    const revenue = group.reduce((sum, r) => sum + Number(r.total_amount ?? 0), 0);
    const collections = group.reduce((sum, r) => sum + Number(r.deposit_amount ?? 0), 0);
    return {
      label,
      revenue,
      jobs: nuniqueLocal(group.map((r) => r.job_order_no)),
      collections,
      outstanding: revenue - collections,
      color: DEPT_COLORS[label],
    };
  };

  return [build("Press", press), build("Garment", garment)];
}

// Deliberately a BROADER status scope than every other Command Center
// chart on this page (which all read the `orders`/`jobs from getKpis()'s
// ACTIVE_ORDER_STATUSES-filtered fetch) — this section reads its own
// separately-fetched rows, scoped to the same 5-status set Archive
// uses (Approved/In Production/At Warehouse/Ready for Collection/
// Delivered), because it represents total historical actuals for
// reporting, not "current active work." See the caption rendered
// below the table, and page.tsx's query comment, for why this is
// intentional, not a bug.
// (i) affordance next to the section heading — surfaces the scope caveats on
// hover or click instead of as permanent page text.
function InfoPopover({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label="About these figures"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-5 w-5 items-center justify-center rounded-full border border-at-border bg-at-white text-[0.7rem] font-bold italic leading-none text-at-slate transition-colors hover:border-at-accent hover:text-at-accent"
      >
        i
      </button>
      {open && (
        <div
          role="tooltip"
          className="absolute left-7 top-0 z-20 w-72 rounded-at border border-at-border bg-at-white p-3 text-xs leading-relaxed text-at-slate shadow-at-md"
        >
          {children}
        </div>
      )}
    </span>
  );
}

// "Department" view — the 3 donuts + summary table. Unchanged mechanically;
// larger/bolder value cells, quieter header labels.
function DepartmentView({ stats }: { stats: DeptStats[] }) {
  const revenueData = stats.map((s) => ({ name: s.label, value: s.revenue, color: s.color }));
  const jobsData = stats.map((s) => ({ name: s.label, value: s.jobs, color: s.color }));
  const collectionsData = stats.map((s) => ({ name: s.label, value: s.collections, color: s.color }));

  const th = "px-4 py-2 text-[0.68rem] font-semibold uppercase tracking-wide text-at-slate";
  const num = "whitespace-nowrap px-4 py-3 text-right text-base font-bold text-at-navy tabular-nums";

  return (
    <div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <DonutChart title="Revenue" data={revenueData} formatValue={(v) => money(v, 2)} />
        <DonutChart title="Jobs" data={jobsData} formatValue={(v) => v.toLocaleString()} />
        <DonutChart title="Collections" data={collectionsData} formatValue={(v) => money(v, 2)} />
      </div>

      <div className="mt-4 overflow-x-auto rounded-at-lg border border-at-border bg-at-white shadow-at-sm">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-at-border bg-at-bg">
              <th className={th}>Department</th>
              <th className={`${th} text-right`}>Revenue</th>
              <th className={`${th} text-right`}>Jobs</th>
              <th className={`${th} text-right`}>Collections</th>
              <th className={`${th} text-right`}>Outstanding</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((s) => (
              <tr key={s.label} className="border-b border-at-border last:border-0">
                <td className="whitespace-nowrap px-4 py-3 font-bold text-at-navy">
                  <span
                    className="mr-2 inline-block h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: s.color }}
                  />
                  {s.label}
                </td>
                <td className={num}>{money(s.revenue, 2)}</td>
                <td className={num}>{s.jobs.toLocaleString()}</td>
                <td className={num}>{money(s.collections, 2)}</td>
                <td
                  className="whitespace-nowrap px-4 py-3 text-right text-base font-bold tabular-nums"
                  style={{ color: s.outstanding > 0 ? "#ef4444" : "#10b981" }}
                >
                  {money(s.outstanding, 2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// "By Category" view — the two-group legend + 3 stacked bars. The explanatory
// sentence that used to sit above the legend is gone; the color-grouped legend
// carries the Garment/Press split visually.
function CategoryView({
  stats,
  uncategorized,
}: {
  stats: Map<OrderCategory, CatBucket>;
  uncategorized: CatBucket;
}) {
  const hasUncategorized =
    uncategorized.jobs.size > 0 || uncategorized.revenue !== 0 || uncategorized.collections !== 0;

  return (
    <div>
      <CategoryLegend />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <StackedCategoryBar
          title="Revenue"
          metric={(b) => b.revenue}
          stats={stats}
          valueFormatter={(v) => money(v, 2)}
          yTickFormatter={compactNum}
        />
        <StackedCategoryBar
          title="Jobs"
          metric={(b) => b.jobs.size}
          stats={stats}
          valueFormatter={(v) => v.toLocaleString()}
          yTickFormatter={(v) => `${v}`}
        />
        <StackedCategoryBar
          title="Collections"
          metric={(b) => b.collections}
          stats={stats}
          valueFormatter={(v) => money(v, 2)}
          yTickFormatter={compactNum}
        />
      </div>

      {hasUncategorized && (
        <div className="mt-3 rounded-at border border-amber-300 bg-amber-50 px-4 py-2.5 text-xs font-semibold text-amber-800">
          ⚠ {uncategorized.jobs.size} order(s) have a print type not covered by the category
          mapping — they are flagged in the browser console (orderCategory) and NOT included in the
          six categories above, so this section would no longer sum to the department totals until a
          mapping rule is added. Revenue not shown here: {money(uncategorized.revenue, 2)}.
        </div>
      )}
    </div>
  );
}

type DeptView = "Department" | "By Category";

// Merged section: one heading + (i) caveats popover + a pill toggle switching
// between the department (2-way) and category (6-way) views of the SAME rows.
export function DepartmentalPerformanceCharts({ rows }: { rows: DeptPerformanceRow[] }) {
  const [view, setView] = useState<DeptView>("Department");
  // All-time by default (both empty) — same convention as Category
  // Report's own From/To pickers, applied live over the rows already
  // fetched once rather than a second round-trip per range change.
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const hasRange = fromDate !== "" && toDate !== "";
  const rangeValid = !hasRange || fromDate <= toDate;

  const filteredRows = useMemo(() => {
    if (!hasRange || !rangeValid) return rows;
    return rows.filter((r) => r.order_date && r.order_date >= fromDate && r.order_date <= toDate);
  }, [rows, hasRange, rangeValid, fromDate, toDate]);

  const deptStats = useMemo(() => groupDepartmentPerformance(filteredRows), [filteredRows]);
  const category = useMemo(() => groupCategoryBreakdown(filteredRows), [filteredRows]);

  function clearRange() {
    setFromDate("");
    setToDate("");
  }

  // Gated on the UNFILTERED rows — a rep with zero orders ever should
  // still see nothing here, but a real dataset that happens to have zero
  // rows in the currently-picked range should show the "no orders match"
  // message below instead of this section vanishing entirely.
  if (rows.length === 0) return null;

  return (
    <div>
      <div className="mb-3 mt-8 flex items-center gap-2">
        <span className="text-lg font-bold text-at-navy-soft">Departmental Performance</span>
        <InfoPopover>
          <p className="mb-2">
            Includes all approved-and-beyond orders, including completed/delivered ones — figures
            will differ from the Active Orders totals above, which exclude completed orders.
          </p>
          <p>
            &ldquo;Commercial Press&rdquo; is a display label for orders stored as
            &ldquo;Offset&rdquo;.
          </p>
        </InfoPopover>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex gap-2">
          {(["Department", "By Category"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setView(option)}
              className={`rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors ${
                view === option
                  ? "border-at-navy bg-at-navy text-at-white"
                  : "border-at-border bg-at-white text-at-slate hover:border-at-accent"
              }`}
            >
              {option}
            </button>
          ))}
        </div>

        <div>
          <label className="mb-1 block text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
            From (Date Raised)
          </label>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
          />
        </div>
        <div>
          <label className="mb-1 block text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
            To (Date Raised)
          </label>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
          />
        </div>
        {hasRange && (
          <Button variant="secondary" size="sm" onClick={clearRange}>
            Clear
          </Button>
        )}
      </div>

      {hasRange && !rangeValid && (
        <div className="mb-3 text-sm font-semibold text-red-600">
          From Date must be on or before To Date — showing all-time until fixed.
        </div>
      )}

      {filteredRows.length === 0 ? (
        <div className="rounded-at-lg border border-at-border bg-at-white p-6 text-sm text-at-slate shadow-at-sm">
          No orders match this date range.
        </div>
      ) : view === "Department" ? (
        <DepartmentView stats={deptStats} />
      ) : (
        <CategoryView stats={category.stats} uncategorized={category.uncategorized} />
      )}
    </div>
  );
}

/* ── Category Breakdown (6-way) ────────────────────────────────────── */

// Garment categories in the amber family, Press in the blue family — the same
// two hues Departmental Performance uses (Garment #d97706 / Press #0369a1),
// shaded so the six are distinguishable while the group is still readable.
const CATEGORY_COLORS: Record<OrderCategory, string> = {
  "Screen Print": "#b45309",
  "Large Format": "#d97706",
  Embroidery: "#f59e0b",
  "Commercial Press": "#075985",
  "Digital Press": "#0369a1",
  Packaging: "#0ea5e9",
};

interface CatBucket {
  revenue: number;
  collections: number;
  jobs: Set<string>;
}

// Reuses the SHARED orderCategory() mapping (src/lib/order-category.ts) — the
// classification is never re-derived here. Jobs is a distinct job_order_no
// count, matching Departmental Performance exactly, so the six category
// subtotals sum to the two department totals.
function groupCategoryBreakdown(rows: DeptPerformanceRow[]) {
  const stats = new Map<OrderCategory, CatBucket>();
  for (const c of ORDER_CATEGORIES) stats.set(c, { revenue: 0, collections: 0, jobs: new Set() });
  const uncategorized: CatBucket = { revenue: 0, collections: 0, jobs: new Set() };

  for (const r of rows) {
    const c = orderCategory(r);
    const bucket = c ? (stats.get(c) as CatBucket) : uncategorized;
    bucket.revenue += Number(r.total_amount ?? 0);
    bucket.collections += Number(r.deposit_amount ?? 0);
    if (r.job_order_no) bucket.jobs.add(r.job_order_no);
  }
  return { stats, uncategorized };
}

function compactNum(n: number): string {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return `${n}`;
}

const EMPTY_BUCKET: CatBucket = { revenue: 0, collections: 0, jobs: new Set() };

// One stacked bar chart per metric: X = [Garment, Press], each bar stacked from
// its own 3 sub-categories — so each bar's height IS that department's total.
function StackedCategoryBar({
  title,
  metric,
  stats,
  valueFormatter,
  yTickFormatter,
}: {
  title: string;
  metric: (b: CatBucket) => number;
  stats: Map<OrderCategory, CatBucket>;
  valueFormatter: (v: number) => string;
  yTickFormatter: (v: number) => string;
}) {
  const data = [
    {
      group: "Garment",
      ...Object.fromEntries(GARMENT_CATEGORIES.map((c) => [c, metric(stats.get(c) ?? EMPTY_BUCKET)])),
    },
    {
      group: "Press",
      ...Object.fromEntries(PRESS_CATEGORIES.map((c) => [c, metric(stats.get(c) ?? EMPTY_BUCKET)])),
    },
  ];
  return (
    <div className="rounded-at-lg border border-at-border bg-at-white p-4 shadow-at-sm">
      <div className="mb-2 text-xs font-bold uppercase tracking-wide text-at-slate">{title}</div>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef2f7" />
          <XAxis dataKey="group" tick={{ fontSize: 12, fontWeight: 600 }} />
          <YAxis tick={{ fontSize: 11 }} width={52} tickFormatter={yTickFormatter} />
          <Tooltip content={<ChartTooltip valueFormatter={valueFormatter} />} cursor={{ fill: "#f8fafc" }} />
          {/* Legend is rendered once for the whole section (CategoryLegend),
              grouped by Garment/Press — not per-chart. */}
          {ORDER_CATEGORIES.map((c) => (
            <Bar key={c} dataKey={c} stackId="a" name={c} fill={CATEGORY_COLORS[c]} maxBarSize={96} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// One shared legend for the section, split into the two labeled groups
// (Garment / Press) that mirror the amber/blue bar grouping — not a flat
// 6-item list, and not repeated per chart.
function CategoryLegend() {
  const groups: { label: string; cats: readonly OrderCategory[] }[] = [
    { label: "Garment", cats: GARMENT_CATEGORIES },
    { label: "Press", cats: PRESS_CATEGORIES },
  ];
  return (
    <div className="mb-3 flex flex-wrap gap-x-8 gap-y-2">
      {groups.map((g) => (
        <div key={g.label} className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
            {g.label}
          </span>
          {g.cats.map((c) => (
            <span key={c} className="flex items-center gap-1.5 text-xs text-at-navy">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: CATEGORY_COLORS[c] }}
              />
              {c}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

// (CategoryBreakdownCharts merged into DepartmentalPerformanceCharts above as
// the "By Category" toggle view — see CategoryView.)
