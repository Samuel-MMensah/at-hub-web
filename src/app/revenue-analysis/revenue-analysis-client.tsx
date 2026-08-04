"use client";

import { useMemo, useState } from "react";
import { monthKeyAndLabel } from "@/lib/month-groups";
import { weekKeyAndLabel } from "@/lib/week-groups";

const CURRENCY = "GH₵";

export interface InvoiceRow {
  id: number;
  date: string;
  revenue_category: string;
  invoice_total: number;
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

type Period = "Weekly" | "Monthly";

function money(n: number): string {
  return `${CURRENCY}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

  return (
    <div>
      {/* Same pill-toggle pattern as Command Center's Trend chart
          (charts.tsx's Weekly/Monthly buttons) — not a new toggle
          convention invented for this page. */}
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
      )}
    </div>
  );
}
