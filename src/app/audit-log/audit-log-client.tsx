"use client";

import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CollapsibleMonthGroup } from "@/components/ui/collapsible-month-group";
import { parseTimestamptz } from "@/lib/parse-timestamptz";
import { currentMonthKey, groupByMonth, type MonthGroup } from "@/lib/month-groups";
import { isGarment, type GarmentClassifiable } from "@/lib/is-garment";
import { matchesSearch } from "@/lib/text-search";

const CURRENCY = "GH₵";

export interface AuditOrderRow extends GarmentClassifiable {
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
  total_amount: number | null;
  deposit_amount: number | null;
  date_of_collection: string | null;
  rejection_note: string | null;
  // Blank/"—" for any order raised before Sales Rep became required
  // (2026-08-31 audit-trail addition) — a direct column read, no join.
  sales_rep: string | null;
}

// First 9 columns match Archive's exact format/order (Status moved to
// front here since Audit Log spans all 8 statuses at once, unlike
// Archive's tabs which are each pre-filtered to one status already).
// The last 5 are Audit-Log-specific fields with real audit-trail value
// that Archive's format doesn't carry (who raised it, when it was
// approved/delivered, the payment receipt) — kept, not dropped, per
// explicit sign-off; see git history for the session this landed in.
// "Warehouse Date" (previously here) is dropped: it has no backing
// column — warehouse_date isn't a real job_orders column (confirmed via
// information_schema) and was always rendered blank.
const COLUMNS = [
  "Status",
  "Order No",
  "Customer",
  "Dept",
  `Total (${CURRENCY})`,
  `Deposit (${CURRENCY})`,
  `Balance (${CURRENCY})`,
  "Collection",
  "Sales Rep",
  "Auth By",
  "Created By",
  "Order Date",
  "Approval Date",
  "Delivered Date",
  "Receipt No",
  "Rejection Reason",
] as const;

function money(n: number): string {
  return `${CURRENCY}${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}

function toRow(order: AuditOrderRow): string[] {
  const total = Number(order.total_amount ?? 0);
  const deposit = Number(order.deposit_amount ?? 0);
  const balance = total - deposit; // not clamped — matches Archive's own balance convention
  return [
    order.status ?? "",
    order.job_order_no ?? "",
    order.customer_name ?? "",
    isGarment(order) ? "GARMENT" : "PRESS",
    total.toFixed(2),
    deposit.toFixed(2),
    balance.toFixed(2),
    order.date_of_collection ?? "",
    order.sales_rep ?? "",
    order.approved_by ?? "",
    order.created_by ?? "",
    order.order_date ?? "",
    order.approval_date ?? "",
    order.delivered_date ?? "",
    order.receipt_no ?? "",
    // Gated on status, not just the raw field's nullness — a resubmitted
    // order that was once Rejected and later re-approved could in
    // principle still carry a stale rejection_note from that earlier
    // rejection (the reject action writes it but nothing clears it on
    // resubmit/approve), so this only surfaces the reason while the
    // order is actually sitting in Rejected, matching Auth By's own
    // "blank unless it currently applies" pattern.
    order.status === "Rejected" ? order.rejection_note ?? "" : "",
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
    return orders.filter((order) => {
      if (statusFilter.length > 0 && (!order.status || !statusFilter.includes(order.status))) {
        return false;
      }
      return matchesSearch(search, [order.customer_name, order.job_order_no, order.created_by, order.approved_by]);
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
<Download size={14} /> Download Audit Log CSV
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
                className={`rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors ${
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
                {month.items.map((order) => {
                  const total = Number(order.total_amount ?? 0);
                  const deposit = Number(order.deposit_amount ?? 0);
                  const balance = total - deposit; // not clamped — matches Archive's own balance convention
                  return (
                    <tr key={order.id} className="border-b border-at-border last:border-0 hover:bg-at-bg">
                      <td className="whitespace-nowrap px-4 py-2.5 text-at-navy">{order.status || "—"}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-at-navy">{order.job_order_no || "—"}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-at-navy">{order.customer_name || "—"}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-at-navy">
                        {isGarment(order) ? "GARMENT" : "PRESS"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-at-navy">{money(total)}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-at-navy">{money(deposit)}</td>
                      <td
                        className="whitespace-nowrap px-4 py-2.5 font-semibold"
                        style={{ color: balance > 0 ? "#ef4444" : "#10b981" }}
                      >
                        {money(balance)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-at-navy">
                        {order.date_of_collection || "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-at-navy">{order.sales_rep || "—"}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-at-navy">{order.approved_by || "—"}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-at-navy">{order.created_by || "—"}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-at-navy">{order.order_date || "—"}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-at-navy">{order.approval_date || "—"}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-at-navy">{order.delivered_date || "—"}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-at-navy">{order.receipt_no || "—"}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-at-navy">
                        {order.status === "Rejected" ? order.rejection_note || "—" : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CollapsibleMonthGroup>
      ))}
    </div>
  );
}
