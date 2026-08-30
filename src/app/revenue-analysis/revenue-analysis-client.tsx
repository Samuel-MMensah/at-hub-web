"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type LabelProps,
} from "recharts";
import { monthKeyAndLabel } from "@/lib/month-groups";
import { weekKeyAndLabel } from "@/lib/week-groups";
import { DonutChart } from "@/components/ui/donut-chart";
import { Button } from "@/components/ui/button";

const CURRENCY = "GH₵";

export interface InvoiceRow {
  id: number;
  date: string;
  customer_name: string | null;
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
// donut with its own legend — reusing the same palette's slots here (not
// a fresh, unvalidated pick) is standard practice already established on
// this exact page family (Command Center reuses CATEGORICAL_PALETTE
// across its own separate chart sections the same way), not a source of
// confusion with the Revenue Trend chart above since each chart carries
// its own legend naming what its colors mean.
//
// SAMPLE/CSR/REPLACEMENT added 2026-08-15 alongside the CHECK constraint
// migration that introduced them (supabase/migrations/20260815090000_...),
// reusing REVENUE_CATEGORY_COLORS' own 7-slot palette in the same fixed
// order (not a fresh pick) — independently re-validated as a 7-slot set
// against this app's card surface, not assumed valid just because it's
// the same hex list already used above for revenue_category:
// `node scripts/validate_palette.js
// "#2a78d6,#eb6834,#1baf7a,#eda100,#e87ba4,#008300,#4a3aa7" --mode light
// --surface "#ffffff"` — all hard gates PASS (worst adjacent CVD ΔE 9.1,
// worst normal-vision ΔE 19.6). The contrast WARN (3 slots below 3:1) is
// the same one that already covered GOVERNMENT/SUBSIDIARY before this
// change — satisfied by DonutChart's own built-in slice labels + legend
// (visible-label relief), not a new gap introduced here.
const BUSINESS_UNITS = ["WALK-IN", "PRIVATE", "GOVERNMENT", "SUBSIDIARY", "SAMPLE", "CSR", "REPLACEMENT"] as const;
const BUSINESS_UNIT_COLORS: Record<string, string> = {
  "WALK-IN": "#2a78d6",
  PRIVATE: "#eb6834",
  GOVERNMENT: "#1baf7a",
  SUBSIDIARY: "#eda100",
  SAMPLE: "#e87ba4",
  CSR: "#008300",
  REPLACEMENT: "#4a3aa7",
};
// Fallback for a business_unit value the live CHECK constraint accepts but
// this list hasn't been updated for yet — exactly the bug class just
// fixed (the old fixed 4-item list silently dropped SAMPLE/CSR/REPLACEMENT
// sums from this donut; invisible only because all three were $0 in the
// June data). A deliberate neutral "Other" bucket per the dataviz skill's
// own rule ("a 9th series is never a generated hue — it folds into
// Other"), not a validated categorical hue.
const UNKNOWN_BUSINESS_UNIT_COLOR = "#6b7280";

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
// Fixed slice order for known categories (never re-sorted by value),
// matching the same "fixed hue anchors" rule the categorical palette
// itself follows — BUT the final slice list is derived from the data's
// own distinct business_unit values, not hardcoded to BUSINESS_UNITS
// alone. That distinction is the actual fix: the old version summed
// every row correctly into the Map but then only ever returned
// BUSINESS_UNITS.map(...), silently dropping any value not in that fixed
// list from the rendered chart (this is exactly how SAMPLE/CSR/REPLACEMENT
// went missing here before — invisible only because all three were $0 in
// the June data). Known categories still get their fixed, validated
// color in fixed order; anything genuinely new falls back to a neutral
// "Other" color instead of vanishing, so the NEXT forgotten category is
// visible-but-uncolored rather than silently dropped like this one was.
function buildBusinessUnitData(invoices: InvoiceRow[]) {
  const sums = new Map<string, number>();
  for (const bu of BUSINESS_UNITS) sums.set(bu, 0);
  for (const inv of invoices) {
    sums.set(inv.business_unit, (sums.get(inv.business_unit) ?? 0) + inv.invoice_total);
  }
  const known = BUSINESS_UNITS.map((bu) => ({ name: bu, value: sums.get(bu) ?? 0, color: BUSINESS_UNIT_COLORS[bu] }));
  const unrecognized = Array.from(sums.keys())
    .filter((name) => !(BUSINESS_UNITS as readonly string[]).includes(name))
    .map((name) => ({ name, value: sums.get(name) ?? 0, color: UNKNOWN_BUSINESS_UNIT_COLOR }));
  return [...known, ...unrecognized];
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

// Drill-down row shape — the exact invoice-level detail that sums to
// a bucket's `value`, produced in the SAME pass as that sum below
// (never a second, separately-filtered query) so the two can't drift.
interface AgingRow {
  id: number;
  customerName: string | null;
  date: string;
  daysOverdue: number;
  balance: number;
}

interface AgingBucket {
  name: string;
  value: number;
  color: string;
  rows: AgingRow[];
}

function buildAgingData(invoices: InvoiceRow[]): AgingBucket[] {
  const today = todayUtcMidnight();
  const buckets: AgingBucket[] = AGING_BUCKETS.map((name, i) => ({
    name,
    value: 0,
    color: AGING_COLORS[i],
    rows: [],
  }));

  for (const inv of invoices) {
    if (inv.balance <= 0) continue;
    const invoiceDate = parseDateOnly(inv.date);
    const daysOverdue = Math.floor((today.getTime() - invoiceDate.getTime()) / (1000 * 60 * 60 * 24));
    const bucketIndex = daysOverdue <= 30 ? 0 : daysOverdue <= 60 ? 1 : daysOverdue <= 90 ? 2 : 3;
    const bucket = buckets[bucketIndex];
    bucket.value += inv.balance;
    bucket.rows.push({
      id: inv.id,
      customerName: inv.customer_name,
      date: inv.date,
      daysOverdue,
      balance: inv.balance,
    });
  }

  // Highest-risk first within each bucket — same order the drill-down
  // modal displays, computed once here rather than re-sorted per open.
  for (const bucket of buckets) {
    bucket.rows.sort((a, b) => b.balance - a.balance);
  }

  return buckets;
}

// Reads the SAME bucket sums buildAgingData already computed — no
// second query, no re-derivation. "31+ days overdue" == every bucket
// except Current, matching the sentence's own wording exactly.
function buildAgingTakeaway(buckets: AgingBucket[]): string {
  const total = buckets.reduce((sum, b) => sum + b.value, 0);
  if (total === 0) {
    return "No outstanding revenue to age — every invoice is fully paid.";
  }

  const current = buckets[0].value;
  const overdue = total - current;
  if (overdue === 0) {
    return `100% of outstanding revenue (${money(total)}) is current (0-30 days) — nothing is overdue.`;
  }

  // overduePct derived as the complement of currentPct (not
  // independently rounded) so the two always sum to exactly 100,
  // never a rounding artifact like "51% + 50%".
  const currentPct = Math.round((current / total) * 100);
  const overduePct = 100 - currentPct;
  return `${currentPct}% of outstanding revenue is current (0-30 days); ${overduePct}% is 31+ days overdue.`;
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// Same downloadCsv shape as Audit Log/My Sales Dashboard — duplicated
// locally per this codebase's established per-file convention.
function downloadCsv(filenamePrefix: string, columns: string[], rows: string[][]) {
  const lines = [columns.join(","), ...rows.map((row) => row.map(csvEscape).join(","))];
  const csv = lines.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  link.href = url;
  link.download = `${filenamePrefix}_${yyyy}${mm}${dd}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

const DRILLDOWN_COLUMNS = ["Customer", "Invoice Date", "Days Overdue", "Balance"];

function agingRowToCsv(row: AgingRow): string[] {
  return [row.customerName ?? "", row.date, String(row.daysOverdue), row.balance.toFixed(2)];
}

// Read-only detail view, not a destructive confirmation — same
// overlay+panel structure as Archive's DeleteMasterOrderSection modal
// (the one existing modal precedent in this app), but no backdrop-click
// dismissal was added there either, so this doesn't invent one: an
// explicit Close button only, matching that precedent exactly.
function AgingDrilldownModal({ bucket, onClose }: { bucket: AgingBucket; onClose: () => void }) {
  function exportCsv() {
    downloadCsv(`ATP_ar_aging_${bucket.name.replace(/[^a-z0-9]+/gi, "_")}`, DRILLDOWN_COLUMNS, bucket.rows.map(agingRowToCsv));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-at-lg bg-at-white p-6 shadow-at-md">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <div className="text-base font-bold text-at-navy">{bucket.name}</div>
            <div className="mt-0.5 text-xs text-at-slate">
              {bucket.rows.length} invoice{bucket.rows.length === 1 ? "" : "s"} · {money(bucket.value)} total
              outstanding
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>

        <div className="mb-3">
          <Button onClick={exportCsv}>⬇️ Download CSV</Button>
        </div>

        <div className="overflow-y-auto rounded-at border border-at-border">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-at-border bg-at-bg">
                <th className="whitespace-nowrap px-4 py-2.5 text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
                  Customer
                </th>
                <th className="whitespace-nowrap px-4 py-2.5 text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
                  Invoice Date
                </th>
                <th className="whitespace-nowrap px-4 py-2.5 text-right text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
                  Days Overdue
                </th>
                <th className="whitespace-nowrap px-4 py-2.5 text-right text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
                  Balance
                </th>
              </tr>
            </thead>
            <tbody>
              {bucket.rows.map((row) => (
                <tr key={row.id} className="border-b border-at-border last:border-0 hover:bg-at-bg">
                  <td className="whitespace-nowrap px-4 py-2.5 font-semibold text-at-navy">
                    {row.customerName || "—"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-at-navy">{row.date}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right text-at-navy">{row.daysOverdue}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right font-bold text-at-navy">
                    {money(row.balance)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-at-navy bg-at-bg">
                <td colSpan={3} className="whitespace-nowrap px-4 py-2.5 font-extrabold text-at-navy">
                  TOTAL
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right font-extrabold text-at-navy">
                  {money(bucket.value)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}

// Renders ONLY for a zero-value bar — a genuinely-checked-and-empty
// bucket needs to read differently from "no bar rendered at all"
// (which looks identical to a loading/broken state). Grey, matching
// this app's existing em-dash "no data" convention (Audit Log/Archive/
// the table just below this chart's own `v === 0 ? "—" : money(v)`).
function ZeroBucketLabel(props: LabelProps) {
  const viewBox = props.viewBox as { x?: number; y?: number; width?: number } | undefined;
  if (props.value !== 0 || !viewBox) return null;
  const x = (viewBox.x ?? 0) + (viewBox.width ?? 0) / 2;
  const y = (viewBox.y ?? 0) - 6;
  return (
    <text x={x} y={y} textAnchor="middle" fill="#94a3b8" fontSize={11} fontWeight={600}>
      {money(0)}
    </text>
  );
}

function AgingChart({ data }: { data: AgingBucket[] }) {
  const [selectedBucket, setSelectedBucket] = useState<AgingBucket | null>(null);
  const takeaway = useMemo(() => buildAgingTakeaway(data), [data]);

  // Zero buckets aren't clickable — there's nothing to drill into, and
  // an empty modal would just be noise. The GH₵0.00 label (below) is
  // what confirms "genuinely checked, genuinely zero" instead.
  function handleBarClick(entry: AgingBucket) {
    if (entry.rows.length === 0) return;
    setSelectedBucket(entry);
  }

  return (
    <div className="rounded-at-lg border border-at-border bg-at-white p-4 shadow-at-sm">
      <div className="text-xs font-bold uppercase tracking-wide text-at-slate">AR Aging</div>
      {/* MANDATORY, visible caption — not a tooltip, not a code comment.
          Anyone looking at this chart needs to see this limitation
          without hovering or reading source. */}
      <div className="mb-2 mt-1 text-xs text-at-slate">
        Aged by original invoice date — does not reflect partial payments made against older
        invoices, since payment timing isn&apos;t separately tracked.
      </div>
      <div className="mb-3 text-sm font-semibold text-at-navy">{takeaway}</div>
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
              <Cell
                key={entry.name}
                fill={entry.color}
                cursor={entry.rows.length > 0 ? "pointer" : "default"}
                onClick={() => handleBarClick(entry)}
              />
            ))}
            <LabelList dataKey="value" content={ZeroBucketLabel} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {selectedBucket && <AgingDrilldownModal bucket={selectedBucket} onClose={() => setSelectedBucket(null)} />}
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
        <DonutChart
          title="Business Unit Breakdown"
          data={businessUnitData}
          formatValue={money}
          caption="All invoices, all-time — not filtered by the Weekly/Monthly toggle below."
        />
        <DonutChart
          title="Collections vs Outstanding"
          data={collectionsData}
          formatValue={money}
          caption="All invoices, all-time — not filtered by the Weekly/Monthly toggle below."
        />
      </div>

      {/* AR Aging — also company-wide, also not period-filtered; a
          "right now" snapshot of outstanding balances by age, not a
          historical trend. */}
      <div className="mb-6">
        <AgingChart data={agingData} />
      </div>

      {/* MANDATORY, permanent caption — not a tooltip. Same convention as
          AR Aging above. */}
      <div className="mb-3 text-xs text-at-slate">
        Includes every invoice in the selected range, regardless of status — DELIVERED, IN
        PRODUCTION, or blank.
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
