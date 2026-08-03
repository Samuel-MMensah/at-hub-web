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
import { isGarment, type GarmentClassifiable } from "@/lib/is-garment";

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

function weekStart(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diffToMonday = (day + 6) % 7;
  d.setUTCDate(d.getUTCDate() - diffToMonday);
  return d;
}

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
          <div className="mb-1 text-xs font-bold uppercase tracking-wide text-at-slate">
            Revenue by Job
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
      <SectionHeader>Order Intake Trend — Daily Contract Value</SectionHeader>
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

// Same donut technique as CapacityCharts' "Revenue by Job" pie above —
// innerRadius/outerRadius/paddingAngle/Cell/Legend all identical.
// Deliberately different from that one: the label shows the exact
// formatted value AND the percentage (not percentage alone) — this
// section is for a management presentation, not a compact dashboard
// tile, so precision on the slice itself matters.
function DepartmentDonut({
  title,
  data,
  formatValue,
}: {
  title: string;
  data: { name: string; value: number; color: string }[];
  formatValue: (v: number) => string;
}) {
  return (
    <div className="rounded-at-lg border border-at-border bg-at-white p-4 shadow-at-sm">
      <div className="mb-2 text-xs font-bold uppercase tracking-wide text-at-slate">{title}</div>
      <ResponsiveContainer width="100%" height={260}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius="52%"
            outerRadius="78%"
            paddingAngle={2}
            label={({ value, percent }: { value?: number; percent?: number }) =>
              value != null && percent != null
                ? `${formatValue(value)} (${(percent * 100).toFixed(0)}%)`
                : ""
            }
            labelLine={false}
          >
            {data.map((entry) => (
              <Cell key={entry.name} fill={entry.color} stroke="#ffffff" strokeWidth={2} />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltip valueFormatter={formatValue} />} />
          <Legend
            verticalAlign="bottom"
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 11, color: "#64748b" }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
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
export function DepartmentalPerformanceCharts({ rows }: { rows: DeptPerformanceRow[] }) {
  const stats = useMemo(() => groupDepartmentPerformance(rows), [rows]);

  if (rows.length === 0) return null;

  const revenueData = stats.map((s) => ({ name: s.label, value: s.revenue, color: s.color }));
  const jobsData = stats.map((s) => ({ name: s.label, value: s.jobs, color: s.color }));
  const collectionsData = stats.map((s) => ({ name: s.label, value: s.collections, color: s.color }));

  return (
    <div>
      <SectionHeader>Departmental Performance</SectionHeader>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <DepartmentDonut title="Revenue" data={revenueData} formatValue={(v) => money(v, 2)} />
        <DepartmentDonut title="Jobs" data={jobsData} formatValue={(v) => v.toLocaleString()} />
        <DepartmentDonut
          title="Collections"
          data={collectionsData}
          formatValue={(v) => money(v, 2)}
        />
      </div>

      <div className="mt-4 overflow-x-auto rounded-at-lg border border-at-border bg-at-white shadow-at-sm">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-at-border bg-at-bg">
              <th className="px-4 py-2.5 text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
                Department
              </th>
              <th className="px-4 py-2.5 text-right text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
                Revenue
              </th>
              <th className="px-4 py-2.5 text-right text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
                Jobs
              </th>
              <th className="px-4 py-2.5 text-right text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
                Collections
              </th>
              <th className="px-4 py-2.5 text-right text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
                Outstanding
              </th>
            </tr>
          </thead>
          <tbody>
            {stats.map((s) => (
              <tr key={s.label} className="border-b border-at-border last:border-0">
                <td className="whitespace-nowrap px-4 py-2.5 font-bold text-at-navy">
                  <span
                    className="mr-2 inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: s.color }}
                  />
                  {s.label}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right font-semibold text-at-navy">
                  {money(s.revenue, 2)}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right font-semibold text-at-navy">
                  {s.jobs.toLocaleString()}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right font-semibold text-at-navy">
                  {money(s.collections, 2)}
                </td>
                <td
                  className="whitespace-nowrap px-4 py-2.5 text-right font-semibold"
                  style={{ color: s.outstanding > 0 ? "#ef4444" : "#10b981" }}
                >
                  {money(s.outstanding, 2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-2 text-xs text-at-slate">
        Includes all approved-and-beyond orders, including completed/delivered ones — figures
        will differ from the Active Orders totals above, which exclude completed orders.
      </div>
    </div>
  );
}
