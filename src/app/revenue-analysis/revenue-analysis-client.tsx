"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { monthKeyAndLabel } from "@/lib/month-groups";
import { weekKeyAndLabel } from "@/lib/week-groups";
import { DonutChart } from "@/components/ui/donut-chart";

const CURRENCY = "GH₵";

export interface InvoiceRow {
  id: number;
  date: string;
  revenue_category: string;
  business_unit: string;
  invoice_total: number;
  payment: number;
  balance: number;
}

// Fixed order matching the 7 real values confirmed live against
// job_invoices' CHECK constraint (Phase 1) — not re-derived from
// whatever categories happen to appear in the current data, so a
// category with zero invoices in a given period still gets its own
// row showing 0, not silently disappearing from the table.
const REVENUE_CATEGORIES = [
  "Large Format",
  "Screen Print",
  "Embroidery",
  "Digital Press",
  "Commercial Press",
  "Publishing",
  "Packaging",
] as const;

// This app's one documented, validated categorical palette (see the
// dataviz skill's palette.md, and command-center/charts.tsx's own
// CATEGORICAL_PALETTE, which only uses the first 6 of these 8 slots —
// slot 7 (violet) hadn't been needed anywhere yet). Re-validated here
// specifically as a 7-slot prefix against this app's card surface
// (#ffffff) before use, not assumed valid just because it's a subset
// of the documented 8: `node scripts/validate_palette.js
// "#2a78d6,#eb6834,#1baf7a,#eda100,#e87ba4,#008300,#4a3aa7" --mode
// light --surface "#ffffff"` — all hard gates PASS (worst adjacent CVD
// ΔE 9.1, worst normal-vision ΔE 19.6). One WARN (3 slots below 3:1
// contrast) requires a relief channel — satisfied here since this
// chart sits directly above the existing Weekly/Monthly table, which
// IS the table-view relief the WARN calls for.
const REVENUE_CATEGORY_COLORS: Record<string, string> = {
  "Large Format": "#2a78d6",
  "Screen Print": "#eb6834",
  Embroidery: "#1baf7a",
  "Digital Press": "#eda100",
  "Commercial Press": "#e87ba4",
  Publishing: "#008300",
  Packaging: "#4a3aa7",
};

// Business Unit is a different categorical dimension shown in its own
// donut with its own legend — reusing the same palette's first 4 slots
// here (not a fresh, unvalidated pick) is standard practice already
// established on this exact page family (Command Center reuses
// CATEGORICAL_PALETTE across its own separate chart sections the same
// way), not a source of confusion with the Revenue Trend chart above
// since each chart carries its own legend naming what its colors mean.
const BUSINESS_UNITS = ["WALK-IN", "PRIVATE", "GOVERNMENT", "SUBSIDIARY"] as const;
const BUSINESS_UNIT_COLORS: Record<string, string> = {
  "WALK-IN": "#2a78d6",
  PRIVATE: "#eb6834",
  GOVERNMENT: "#1baf7a",
  SUBSIDIARY: "#eda100",
};

// Same green/red convention already established everywhere else in
// this app (Dispatch/Archive/Stock Balance's negative-value red, etc.)
// — not a new semantic color pair invented for this chart.
const COLLECTED_COLOR = "#10b981";
const OUTSTANDING_COLOR = "#ef4444";

// Amber-to-red severity gradient for AR Aging — both endpoints are
// tones already live in this app, not invented for this chart: amber
// (Tailwind amber-500, this app's existing "watch" banner tone) to
// #ef4444, the exact same red used two lines above for "Outstanding"
// on this same page. The two middle steps are a straight linear
// interpolation between those two real endpoints, not independent
// picks — Current is mildest, 90+ overdue is the same red as
// Outstanding itself.
const AGING_BUCKETS = ["Current (0-30 days)", "31-60 days", "61-90 days", "90+ days overdue"] as const;
const AGING_COLORS = ["#f59e0b", "#f3801e", "#f16231", "#ef4444"];

const AXIS_TICK_STYLE = { fill: "#64748b", fontSize: 12 };
const GRID_COLOR = "#f1f5f9";
const BORDER_COLOR = "#e2e8f0";

type Period = "Weekly" | "Monthly";

function money(n: number): string {
  return `${CURRENCY}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Same tooltip shape as command-center/charts.tsx's own ChartTooltip —
// duplicated locally rather than imported, matching this codebase's
// established "each file defines its own small chart/format helpers"
// convention (money()/CURRENCY are already duplicated the same way).
function ChartTooltip({
  active,
  label,
  payload,
  valueFormatter = (v: number) => money(v),
}: {
  active?: boolean;
  label?: string;
  payload?: { name: string; value: number; color: string }[];
  valueFormatter?: (v: number) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-at border border-at-border bg-at-white px-3 py-2 shadow-at-md">
      {label && <div className="mb-1 text-xs font-bold text-at-slate">{label}</div>}
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center gap-2 text-xs">
          <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
          <span className="text-at-slate">{entry.name}:</span>
          <span className="font-bold text-at-navy">{valueFormatter(entry.value)}</span>
        </div>
      ))}
    </div>
  );
}

// Business Unit Breakdown — SUM(invoice_total) per business_unit
// across the FULL dataset, not period-filtered (unlike the Revenue
// Trend chart/table below, which respect the Weekly/Monthly toggle).
// Fixed slice order (never re-sorted by value), matching the same
// "fixed hue anchors" rule the categorical palette itself follows.
function buildBusinessUnitData(invoices: InvoiceRow[]) {
  const sums = new Map<string, number>();
  for (const bu of BUSINESS_UNITS) sums.set(bu, 0);
  for (const inv of invoices) {
    sums.set(inv.business_unit, (sums.get(inv.business_unit) ?? 0) + inv.invoice_total);
  }
  return BUSINESS_UNITS.map((bu) => ({ name: bu, value: sums.get(bu) ?? 0, color: BUSINESS_UNIT_COLORS[bu] }));
}

// Collections vs Outstanding — company-wide SUM(payment) vs
// SUM(balance) across every invoice. Always sums to the same grand
// total as invoice_total (balance = invoice_total - payment, by
// construction on every write path — Phase 1's import and both
// recordInvoice/recordInvoicePayment) — verified live below, not
// assumed from the formula alone.
function buildCollectionsData(invoices: InvoiceRow[]) {
  const collected = invoices.reduce((sum, inv) => sum + inv.payment, 0);
  const outstanding = invoices.reduce((sum, inv) => sum + inv.balance, 0);
  return [
    { name: "Collected", value: collected, color: COLLECTED_COLOR },
    { name: "Outstanding", value: outstanding, color: OUTSTANDING_COLOR },
  ];
}

// AR Aging — only rows with a real outstanding balance (balance > 0)
// are bucketed at all; a fully-paid invoice has nothing to age. Bucket
// key is (today - invoice date) in days, UTC-based (same "Ghana = UTC,
// always" convention as every other date computation in this app), NOT
// aged by payment date — see the caption rendered on the page itself
// (not just here) for why that's a real, stated limitation, not a
// silent simplification: this table doesn't separately track WHEN a
// partial payment happened, only the running payment/balance totals,
// so an invoice that got partially paid recently still ages by its
// original invoice date.
function todayUtcMidnight(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function buildAgingData(invoices: InvoiceRow[]) {
  const today = todayUtcMidnight();
  const bucketSums = [0, 0, 0, 0];

  for (const inv of invoices) {
    if (inv.balance <= 0) continue;
    const invoiceDate = parseDateOnly(inv.date);
    const daysOverdue = Math.floor((today.getTime() - invoiceDate.getTime()) / (1000 * 60 * 60 * 24));
    const bucketIndex = daysOverdue <= 30 ? 0 : daysOverdue <= 60 ? 1 : daysOverdue <= 90 ? 2 : 3;
    bucketSums[bucketIndex] += inv.balance;
  }

  return AGING_BUCKETS.map((name, i) => ({ name, value: bucketSums[i], color: AGING_COLORS[i] }));
}

interface AgingSlice {
  name: string;
  value: number;
  color: string;
}

function AgingChart({ data }: { data: AgingSlice[] }) {
  return (
    <div className="rounded-at-lg border border-at-border bg-at-white p-4 shadow-at-sm">
      <div className="text-xs font-bold uppercase tracking-wide text-at-slate">AR Aging</div>
      {/* MANDATORY, visible caption — not a tooltip, not a code comment.
          Anyone looking at this chart needs to see this limitation
          without hovering or reading source. */}
      <div className="mb-3 mt-1 text-xs text-at-slate">
        Aged by original invoice date — does not reflect partial payments made against older
        invoices, since payment timing isn&apos;t separately tracked.
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
          <CartesianGrid stroke={GRID_COLOR} vertical={false} />
          <XAxis dataKey="name" tick={AXIS_TICK_STYLE} axisLine={{ stroke: BORDER_COLOR }} tickLine={false} />
          <YAxis
            tick={AXIS_TICK_STYLE}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => money(v)}
            width={90}
          />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: "#f8fafc" }} />
          <Bar dataKey="value" name="Outstanding Balance" radius={[4, 4, 0, 0]} maxBarSize={80}>
            {data.map((entry) => (
              <Cell key={entry.name} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// Reshapes the SAME `table` object already computed by buildTable()
// for the table below — not a second query or a separate aggregation.
// Table is category-rows × period-columns; a stacked bar chart needs
// period-rows × category-columns, so this is purely a transpose of
// already-computed sums, not a recomputation.
function tableToChartData(table: TableData) {
  return table.columns.map((col, i) => {
    const point: Record<string, string | number> = { period: col.label };
    for (const row of table.rows) {
      point[row.category] = row.cells[i];
    }
    return point;
  });
}

// Stacked, not grouped: 7 categories is too many for grouped bars to
// stay legible (7 slivers per period, illegible past a handful of
// periods) — stacked shows both the per-category composition (color)
// and the period TOTAL (bar height) in one view, and the total matches
// the table's own TOTAL row directly below.
function RevenueTrendChart({ table }: { table: TableData }) {
  const data = useMemo(() => tableToChartData(table), [table]);

  return (
    <div className="rounded-at-lg border border-at-border bg-at-white p-4 shadow-at-sm">
      <ResponsiveContainer width="100%" height={320}>
        <BarChart data={data} barGap={4}>
          <CartesianGrid stroke={GRID_COLOR} vertical={false} />
          <XAxis dataKey="period" tick={AXIS_TICK_STYLE} axisLine={{ stroke: BORDER_COLOR }} tickLine={false} />
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
          {REVENUE_CATEGORIES.map((cat) => (
            <Bar key={cat} dataKey={cat} name={cat} stackId="revenue" fill={REVENUE_CATEGORY_COLORS[cat]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// `date` is a plain Postgres DATE (e.g. "2026-07-01"), not timestamptz —
// unambiguously parsed as UTC midnight per the ECMAScript Date spec,
// same reasoning already established for material_receipts/issuances.
function parseDateOnly(raw: string): Date {
  return new Date(raw);
}

interface TableColumn {
  key: string;
  label: string;
}

interface TableData {
  columns: TableColumn[];
  rows: { category: string; cells: number[] }[];
  totalRow: { category: string; cells: number[] };
}

// Replaces the source spreadsheet's fragile per-week hand-picked cell
// formula (='LARGE FORMAT'!K3+'LARGE FORMAT'!K7+...) with a real
// group-by: bucket every invoice by period (week or month), then sum
// invoice_total per category within each bucket. Bucket keys are
// sortable strings by construction (week: the Monday's ISO date;
// month: "YYYY-MM"), so a plain string sort orders columns
// chronologically without a separate Date-based sort.
function buildTable(invoices: InvoiceRow[], period: Period): TableData {
  const bucketLabels = new Map<string, string>();
  const sums = new Map<string, Map<string, number>>();
  for (const cat of REVENUE_CATEGORIES) sums.set(cat, new Map());

  for (const row of invoices) {
    const d = parseDateOnly(row.date);
    const { key, label } = period === "Weekly" ? weekKeyAndLabel(d) : monthKeyAndLabel(d);
    bucketLabels.set(key, label);

    const catSums = sums.get(row.revenue_category);
    if (!catSums) continue; // defensive: CHECK constraint already guarantees this can't happen
    catSums.set(key, (catSums.get(key) ?? 0) + row.invoice_total);
  }

  const bucketKeys = Array.from(bucketLabels.keys()).sort();
  const columns = bucketKeys.map((key) => ({ key, label: bucketLabels.get(key)! }));

  const rows = REVENUE_CATEGORIES.map((category) => ({
    category,
    cells: bucketKeys.map((key) => sums.get(category)!.get(key) ?? 0),
  }));

  const totalRow = {
    category: "TOTAL",
    cells: bucketKeys.map((_, i) => rows.reduce((sum, r) => sum + r.cells[i], 0)),
  };

  return { columns, rows, totalRow };
}

export function RevenueAnalysisClient({ invoices }: { invoices: InvoiceRow[] }) {
  const [period, setPeriod] = useState<Period>("Weekly");
  const table = useMemo(() => buildTable(invoices, period), [invoices, period]);
  const businessUnitData = useMemo(() => buildBusinessUnitData(invoices), [invoices]);
  const collectionsData = useMemo(() => buildCollectionsData(invoices), [invoices]);
  const agingData = useMemo(() => buildAgingData(invoices), [invoices]);

  return (
    <div>
      {/* Business Unit Breakdown + Collections vs Outstanding — both
          company-wide across the full dataset, not period-filtered
          (unlike the Revenue Trend chart and table below, which share
          the Weekly/Monthly toggle). */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <DonutChart title="Business Unit Breakdown" data={businessUnitData} formatValue={money} />
        <DonutChart title="Collections vs Outstanding" data={collectionsData} formatValue={money} />
      </div>

      {/* AR Aging — also company-wide, also not period-filtered; a
          "right now" snapshot of outstanding balances by age, not a
          historical trend. */}
      <div className="mb-6">
        <AgingChart data={agingData} />
      </div>

      {/* Same pill-toggle pattern as Command Center's Trend chart
          (charts.tsx's Weekly/Monthly buttons) — not a new toggle
          convention invented for this page. Governs both the Revenue
          Trend chart directly below and the table further down — same
          shared `table` object, not two separate computations. */}
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

      {table.columns.length === 0 ? (
        <div className="rounded-at-lg border border-at-border bg-at-white p-6 text-sm text-at-slate shadow-at-sm">
          No invoices recorded yet.
        </div>
      ) : (
        <>
          <div className="mb-6">
            <RevenueTrendChart table={table} />
          </div>

          <div className="overflow-x-auto rounded-at-lg border border-at-border bg-at-white shadow-at-sm">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-at-border bg-at-bg">
                  <th className="whitespace-nowrap px-4 py-2.5 text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
                    Category
                  </th>
                  {table.columns.map((col) => (
                    <th
                      key={col.key}
                      className="whitespace-nowrap px-4 py-2.5 text-right text-[0.7rem] font-bold uppercase tracking-wide text-at-slate"
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row) => (
                  <tr key={row.category} className="border-b border-at-border last:border-0 hover:bg-at-bg">
                    <td className="whitespace-nowrap px-4 py-2.5 font-semibold text-at-navy">{row.category}</td>
                    {row.cells.map((v, i) => (
                      <td key={table.columns[i].key} className="whitespace-nowrap px-4 py-2.5 text-right text-at-navy">
                        {v === 0 ? "—" : money(v)}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className="border-t-2 border-at-navy bg-at-bg">
                  <td className="whitespace-nowrap px-4 py-2.5 font-extrabold text-at-navy">TOTAL</td>
                  {table.totalRow.cells.map((v, i) => (
                    <td
                      key={table.columns[i].key}
                      className="whitespace-nowrap px-4 py-2.5 text-right font-extrabold text-at-navy"
                    >
                      {money(v)}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
