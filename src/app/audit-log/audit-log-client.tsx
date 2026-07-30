"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { CollapsibleMonthGroup } from "@/components/ui/collapsible-month-group";
import { parseTimestamptz } from "@/lib/parse-timestamptz";
import { currentMonthKey, groupByMonth, type MonthGroup } from "@/lib/month-groups";

export interface AuditOrderRow {
  id: number;
  job_order_no: string | null;
  customer_name: string;
  status: string | null;
  created_by: string;
  created_at: string | null;
  order_date: string | null;
  approved_by: string | null;
  approval_date: string | null;
  delivered_date: string | null;
  receipt_no: string | null;
}

const COLUMNS = [
  "Order No",
  "Customer",
  "Status",
  "Created By",
  "Order Date",
  "Approved By",
  "Approval Date",
  "Warehouse Date",
  "Delivered Date",
  "Receipt No",
] as const;

// Warehouse Date has no backing column — warehouse_date isn't a real
// job_orders column (confirmed via information_schema, and it's never
// written anywhere in app.py either). app.py's own audit-log route
// references it via pandas .get('warehouse_date', '') and always falls
// through to '', so it's blank in production too — this replicates
// that exactly, not a gap in this port.
function toRow(order: AuditOrderRow): string[] {
  return [
    order.job_order_no ?? "",
    order.customer_name ?? "",
    order.status ?? "",
    order.created_by ?? "",
    order.order_date ?? "",
    order.approved_by ?? "",
    order.approval_date ?? "",
    "",
    order.delivered_date ?? "",
    order.receipt_no ?? "",
  ];
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function downloadCsv(rows: string[][]) {
  const lines = [COLUMNS.join(","), ...rows.map((row) => row.map(csvEscape).join(","))];
  const csv = lines.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  link.href = url;
  link.download = `ATP_audit_log_${yyyy}${mm}${dd}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function AuditLogClient({ orders }: { orders: AuditOrderRow[] }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);

  const statusOptions = useMemo(() => {
    const set = new Set<string>();
    for (const order of orders) {
      if (order.status) set.add(order.status);
    }
    return Array.from(set).sort();
  }, [orders]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((order) => {
      if (statusFilter.length > 0 && (!order.status || !statusFilter.includes(order.status))) {
        return false;
      }
      if (!q) return true;
      const haystack = [order.customer_name, order.job_order_no, order.created_by, order.approved_by]
        .map((v) => (v ?? "").toLowerCase())
        .join(" ");
      return haystack.includes(q);
    });
  }, [orders, search, statusFilter]);

  // Grouping happens AFTER filtering — `filtered` is the full matching
  // set across every month, so a search/filter match can never end up
  // hidden inside a collapsed section (see the defaultExpanded rule
  // below). CSV export (downloadCsv) reads `filtered` directly, not
  // anything month-scoped, so it stays unaffected by which months
  // happen to be expanded/collapsed on screen.
  const isFiltering = search.trim() !== "" || statusFilter.length > 0;

  const monthGroups = useMemo(() => {
    // created_at is confirmed live to be populated on every real row
    // (checked directly against Supabase, not assumed) — this fallback
    // bucket exists only so a genuinely unexpected null doesn't crash
    // the page, not because null is expected in practice.
    const withDate = filtered.filter((o) => o.created_at);
    const withoutDate = filtered.filter((o) => !o.created_at);
    const groups: MonthGroup<AuditOrderRow>[] = groupByMonth(withDate, (o) =>
      parseTimestamptz(o.created_at as string)
    );
    if (withoutDate.length > 0) {
      groups.push({ key: "", label: "Unknown Date", items: withoutDate });
    }
    return groups;
  }, [filtered]);

  const currentKey = currentMonthKey();

  function toggleStatus(status: string) {
    setStatusFilter((prev) =>
      prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status]
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Customer · Order No · Created By · Approved By…"
            className="flex-1 rounded-at border border-at-border bg-at-white px-4 py-2.5 text-sm text-at-navy outline-none focus:border-at-accent"
          />
          <Button onClick={() => downloadCsv(filtered.map(toRow))} className="whitespace-nowrap">
            ⬇️ Download Audit Log CSV
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          {statusOptions.map((status) => {
            const active = statusFilter.includes(status);
            return (
              <button
                key={status}
                type="button"
                onClick={() => toggleStatus(status)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                  active
                    ? "border-at-navy bg-at-navy text-at-white"
                    : "border-at-border bg-at-white text-at-slate hover:border-at-accent"
                }`}
              >
                {status}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mb-2 text-xs font-semibold text-at-slate">{filtered.length} order(s)</div>

      {monthGroups.map((month) => (
        <CollapsibleMonthGroup
          key={month.key}
          monthLabel={month.label}
          itemCount={month.items.length}
          defaultExpanded={month.key === currentKey || isFiltering}
        >
          <div className="-mx-4 -my-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-at-border bg-at-bg">
                  {COLUMNS.map((col) => (
                    <th
                      key={col}
                      className="whitespace-nowrap px-4 py-2.5 text-[0.7rem] font-bold uppercase tracking-wide text-at-slate"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {month.items.map((order) => (
                  <tr key={order.id} className="border-b border-at-border last:border-0 hover:bg-at-bg">
                    {toRow(order).map((cell, i) => (
                      <td key={i} className="whitespace-nowrap px-4 py-2.5 text-at-navy">
                        {cell || "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CollapsibleMonthGroup>
      ))}
    </div>
  );
}
