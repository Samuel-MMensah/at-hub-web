"use client";

import { useMemo, useState } from "react";
import { CollapsibleMonthGroup } from "@/components/ui/collapsible-month-group";

const CURRENCY = "GH₵";

export interface StockBalanceRow {
  material_id: number;
  material_description: string;
  section_group: string;
  material_category: string;
  uom: string | null;
  opening_inventory: number;
  receipts: number;
  issuances: number;
  on_hand: number;
  unit_cost_ghc: number;
  value: number;
}

function money(n: number): string {
  return `${CURRENCY}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function qty(n: number): string {
  return n.toLocaleString();
}

const COLUMNS = [
  "Material",
  "Category",
  "UoM",
  "Opening",
  "Receipts",
  "Issuances",
  "On-Hand",
  "Unit Cost",
  "Value",
] as const;

interface SectionGroup {
  key: string;
  label: string;
  items: StockBalanceRow[];
}

// Groups by `section_group` — Audit Log's own "no unpaginated flat
// dump" mechanism is collapsible grouping (there, by month, via
// CollapsibleMonthGroup + month-groups.ts), not literal page-number
// pagination — audit-log-client.tsx has no such control. material_catalog
// has no date to group by, so month-groups.ts's date-bucketing logic
// doesn't apply here; section_group is this data's natural analog.
// Reuses CollapsibleMonthGroup's UI shell directly (its props are
// generic — a label, a count, an expand flag — nothing month-specific
// in the component itself), not month-groups.ts.
function groupBySection(rows: StockBalanceRow[]): SectionGroup[] {
  const map = new Map<string, StockBalanceRow[]>();
  for (const row of rows) {
    const key = row.section_group || "Uncategorized";
    let bucket = map.get(key);
    if (!bucket) {
      bucket = [];
      map.set(key, bucket);
    }
    bucket.push(row);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, items]) => ({ key, label: key, items }));
}

export function StockBalanceClient({ rows }: { rows: StockBalanceRow[] }) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => {
      const haystack = [row.material_description, row.material_category, row.section_group, row.uom]
        .map((v) => (v ?? "").toLowerCase())
        .join(" ");
      return haystack.includes(q);
    });
  }, [rows, search]);

  // No "current" analog for a section the way a calendar has a current
  // month, so nothing is expanded by default on load — every section
  // starts collapsed until the user searches (which force-expands any
  // section containing a match, same rule as Audit Log's isFiltering)
  // or manually opens one. This IS the "no unpaginated flat dump"
  // behavior: nothing renders 479 rows at once on first load.
  const isFiltering = search.trim() !== "";

  const sections = useMemo(() => groupBySection(filtered), [filtered]);

  const totalValue = filtered.reduce((sum, row) => sum + row.value, 0);

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Material · Category · Section…"
          className="flex-1 rounded-at border border-at-border bg-at-white px-4 py-2.5 text-sm text-at-navy outline-none focus:border-at-accent"
        />
        <div className="whitespace-nowrap text-xs font-semibold text-at-slate">
          {filtered.length.toLocaleString()} material(s) · Total Value {money(totalValue)}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-at-lg border border-at-border bg-at-white p-6 text-sm text-at-slate shadow-at-sm">
          No materials match your search.
        </div>
      ) : (
        sections.map((section) => (
          <CollapsibleMonthGroup
            key={section.key}
            monthLabel={section.label}
            itemCount={section.items.length}
            itemLabel="materials"
            defaultExpanded={isFiltering}
          >
            <div className="-mx-4 -my-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-at-border bg-at-bg">
                    {COLUMNS.map((col) => (
                      <th
                        key={col}
                        className={`whitespace-nowrap px-4 py-2.5 text-[0.7rem] font-bold uppercase tracking-wide text-at-slate ${
                          col === "Material" || col === "Category" || col === "UoM" ? "" : "text-right"
                        }`}
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {section.items.map((row) => (
                    <tr key={row.material_id} className="border-b border-at-border last:border-0 hover:bg-at-bg">
                      <td className="whitespace-nowrap px-4 py-2.5 font-semibold text-at-navy">
                        {row.material_description}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-at-slate">{row.material_category}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-at-slate">{row.uom || "—"}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right text-at-navy">
                        {qty(row.opening_inventory)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right text-at-navy">{qty(row.receipts)}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right text-at-navy">{qty(row.issuances)}</td>
                      <td
                        className="whitespace-nowrap px-4 py-2.5 text-right font-bold"
                        style={{ color: row.on_hand < 0 ? "#ef4444" : "#0f172a" }}
                      >
                        {qty(row.on_hand)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right text-at-navy">
                        {money(row.unit_cost_ghc)}
                      </td>
                      <td
                        className="whitespace-nowrap px-4 py-2.5 text-right font-bold"
                        style={{ color: row.value < 0 ? "#ef4444" : "#0f172a" }}
                      >
                        {money(row.value)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CollapsibleMonthGroup>
        ))
      )}
    </div>
  );
}
