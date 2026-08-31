"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CollapsibleMonthGroup } from "@/components/ui/collapsible-month-group";
import { groupByMonth, currentMonthKey, type MonthGroup } from "@/lib/month-groups";
import { orderCategory } from "@/lib/order-category";
import type { GarmentClassifiable } from "@/lib/is-garment";

const CURRENCY = "GH₵";

export interface UninvoicedOrderRow extends GarmentClassifiable {
  id: number;
  job_order_no: string;
  customer_name: string | null;
  status: string;
  total_amount: number;
  order_date: string | null;
  sales_rep: string | null;
}

function money(n: number): string {
  return `${CURRENCY}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// `order_date` is a plain Postgres DATE, not timestamptz — same
// reasoning already established for material_receipts/material_issuances.
function parseDateOnly(raw: string): Date {
  return new Date(raw);
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

// Same downloadCsv shape duplicated per-file elsewhere in this app.
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

const COLUMNS = ["Order No.", "Customer", "Category", "Status", "Contract Value", "Date Raised", "Sales Rep"];
const RIGHT_ALIGNED_COLUMNS = new Set(["Contract Value"]);

function rowToCsv(r: UninvoicedOrderRow): string[] {
  return [
    r.job_order_no,
    r.customer_name ?? "",
    orderCategory(r) ?? "Uncategorized",
    r.status,
    r.total_amount.toFixed(2),
    r.order_date ?? "",
    r.sales_rep ?? "",
  ];
}

export function UninvoicedOrdersClient({ orders }: { orders: UninvoicedOrderRow[] }) {
  const monthGroups: MonthGroup<UninvoicedOrderRow>[] = useMemo(() => {
    // Sort by Contract Value descending FIRST (the required default
    // sort) — groupByMonth preserves each item's relative order within
    // its bucket, so every month's rows stay value-descending while the
    // buckets themselves stay chronological (most-recent-first), same
    // convention as every other list in this app.
    const sorted = [...orders].sort((a, b) => b.total_amount - a.total_amount);
    const withDate = sorted.filter((r) => r.order_date);
    const withoutDate = sorted.filter((r) => !r.order_date);
    const groups = groupByMonth(withDate, (r) => parseDateOnly(r.order_date as string));
    if (withoutDate.length > 0) groups.push({ key: "", label: "Unknown Date", items: withoutDate });
    return groups;
  }, [orders]);
  const currentKey = currentMonthKey();

  // Straight from the same already-filtered `orders` array — not a
  // second query.
  const totalValue = orders.reduce((sum, r) => sum + r.total_amount, 0);

  function exportCsv() {
    const flat = monthGroups.flatMap((g) => g.items);
    downloadCsv("ATP_uninvoiced_orders", COLUMNS, flat.map(rowToCsv));
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-at-lg border border-at-border bg-at-white p-4 shadow-at-sm">
        <div className="text-sm text-at-navy">
          <strong className="text-lg font-extrabold">{orders.length}</strong> order{orders.length === 1 ? "" : "s"},{" "}
          <strong className="text-lg font-extrabold text-red-600">{money(totalValue)}</strong> in uninvoiced contract
          value
        </div>
        {orders.length > 0 && (
          <Button variant="secondary" onClick={exportCsv}>
            <Download size={14} /> Export CSV
          </Button>
        )}
      </div>

      {orders.length === 0 ? (
        <div className="rounded-at-lg border border-at-border bg-at-white p-6 text-sm text-at-slate shadow-at-sm">
          Every approved-or-beyond order has a real invoice — nothing outstanding.
        </div>
      ) : (
        monthGroups.map((month) => (
          <CollapsibleMonthGroup
            key={month.key}
            monthLabel={month.label}
            itemCount={month.items.length}
            itemLabel="orders"
            defaultExpanded={month.key === currentKey}
          >
            <div className="-mx-4 -my-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-at-border bg-at-bg">
                    {COLUMNS.map((col) => (
                      <th
                        key={col}
                        className={`whitespace-nowrap px-4 py-2.5 text-[0.7rem] font-bold uppercase tracking-wide text-at-slate ${
                          RIGHT_ALIGNED_COLUMNS.has(col) ? "text-right" : ""
                        }`}
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {month.items.map((r) => (
                    <tr key={r.id} className="border-b border-at-border last:border-0 hover:bg-at-bg">
                      <td className="whitespace-nowrap px-4 py-2.5">
                        {/* Deep-links into Invoice Entry with this order pre-selected
                            (see invoice-entry-client.tsx's initialOrderNo) — reduces
                            friction from "gap spotted" to "invoice form open". */}
                        <Link
                          href={`/revenue-analysis/invoice-entry?order=${encodeURIComponent(r.job_order_no)}`}
                          className="font-bold text-at-accent hover:underline"
                          title="Create the invoice for this order"
                        >
                          {r.job_order_no}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 font-semibold text-at-navy">
                        {r.customer_name || "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-at-slate">
                        {orderCategory(r) ?? "Uncategorized"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-at-slate">{r.status}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right font-semibold text-at-navy">
                        {money(r.total_amount)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-at-navy">{r.order_date ?? "—"}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-at-slate">{r.sales_rep || "—"}</td>
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
