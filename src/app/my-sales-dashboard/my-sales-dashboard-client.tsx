"use client";

import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CollapsibleMonthGroup } from "@/components/ui/collapsible-month-group";
import { currentMonthKey, groupByMonth, type MonthGroup } from "@/lib/month-groups";

const CURRENCY = "GH₵";

export interface SalesJobOrderRow {
  id: number;
  job_order_no: string;
  client_id: number | null;
  order_date: string | null;
}

export interface SalesInvoiceRow {
  id: number;
  date: string;
  job_order_no: string | null;
  customer_name: string | null;
  client_id: number | null;
  // PostgREST FK embed (job_invoices.client_id -> clients.id) — an
  // object for a to-one relationship, null when client_id itself is
  // null (never linked to a real client record).
  clients: { name: string } | null;
  revenue_category: string;
  business_unit: string;
  quantity: number;
  unit_price: number;
  invoice_total: number;
  payment: number;
  balance: number;
  status: string | null;
  oracle_no: string | null;
}

interface ClientBreakdownRow {
  clientId: number | null;
  clientName: string;
  totalRevenue: number;
  collected: number;
  outstanding: number;
  jobCount: number;
}

function money(n: number): string {
  return `${CURRENCY}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// `date` is a plain Postgres DATE, not timestamptz — same reasoning
// already established for material_receipts/material_issuances/
// Invoice Entry's own history table.
function parseDateOnly(raw: string): Date {
  return new Date(raw);
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// Shared by both exports below — same downloadCsv shape as Audit Log/
// Archive/the materials tabs, generalized over a column list since
// this page has two genuinely different tables to export, not one.
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

function SummaryCard({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div className="rounded-at-lg border border-at-border bg-at-white p-5 shadow-at-sm">
      <div className="mb-1 text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">{label}</div>
      <div className="text-2xl font-extrabold text-at-navy" style={valueColor ? { color: valueColor } : undefined}>
        {value}
      </div>
    </div>
  );
}

const BREAKDOWN_COLUMNS = ["Client", "Total Revenue", "Collected", "Outstanding", "Jobs"];
const ACTIVITY_COLUMNS = [
  "Date",
  "Order No",
  "Customer",
  "Client",
  "Category",
  "Business Unit",
  "Qty",
  "Unit Price",
  "Invoice Total",
  "Payment",
  "Balance",
  "Status",
  "Oracle No",
];

function activityRowToCsv(inv: SalesInvoiceRow): string[] {
  return [
    inv.date,
    inv.job_order_no ?? "",
    inv.customer_name ?? "",
    inv.clients?.name ?? "",
    inv.revenue_category,
    inv.business_unit,
    String(inv.quantity),
    inv.unit_price.toFixed(2),
    inv.invoice_total.toFixed(2),
    inv.payment.toFixed(2),
    inv.balance.toFixed(2),
    inv.status ?? "",
    inv.oracle_no ?? "",
  ];
}

export function MySalesDashboardClient({
  repName,
  jobOrders,
  invoices,
}: {
  repName: string;
  jobOrders: SalesJobOrderRow[];
  invoices: SalesInvoiceRow[];
}) {
  // All-time by default (both empty) — same "no filter until a range is
  // explicitly chosen" convention as Category Report's From/To pickers.
  // Applied live (no separate Generate step) since this is just an
  // in-memory filter over data already fetched once.
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const hasRange = fromDate !== "" && toDate !== "";
  const rangeValid = !hasRange || fromDate <= toDate;

  const filteredInvoices = useMemo(() => {
    if (!hasRange || !rangeValid) return invoices;
    return invoices.filter((i) => i.date >= fromDate && i.date <= toDate);
  }, [invoices, hasRange, rangeValid, fromDate, toDate]);

  // job_orders' own date (order_date, "date raised") is a distinct field
  // from invoices' date — a job order can be raised in one month and
  // invoiced in another, so this is filtered independently rather than
  // reusing the invoice date range's row set.
  const filteredJobOrders = useMemo(() => {
    if (!hasRange || !rangeValid) return jobOrders;
    return jobOrders.filter((o) => o.order_date && o.order_date >= fromDate && o.order_date <= toDate);
  }, [jobOrders, hasRange, rangeValid, fromDate, toDate]);

  function clearRange() {
    setFromDate("");
    setToDate("");
  }

  // Deduped by id already, once, in page.tsx (an unlinked and a linked
  // match are mutually exclusive per the sales_rep_only_when_unlinked
  // CHECK constraint anyway — no real overlap expected, but the dedupe
  // there is the actual safety net, not this component).
  const totalRevenue = useMemo(() => filteredInvoices.reduce((sum, i) => sum + i.invoice_total, 0), [filteredInvoices]);
  const totalCollected = useMemo(() => filteredInvoices.reduce((sum, i) => sum + i.payment, 0), [filteredInvoices]);
  const totalOutstanding = useMemo(() => filteredInvoices.reduce((sum, i) => sum + i.balance, 0), [filteredInvoices]);
  const totalJobsRaised = filteredJobOrders.length;

  // How many of THIS rep's own job_orders belong to a given client —
  // feeds the breakdown table's "Jobs" column. Keyed by client_id
  // (null included as its own bucket, for orders with no client link).
  const jobCountByClient = useMemo(() => {
    const map = new Map<number | null, number>();
    for (const o of filteredJobOrders) {
      map.set(o.client_id, (map.get(o.client_id) ?? 0) + 1);
    }
    return map;
  }, [filteredJobOrders]);

  // One row per DISTINCT client this rep has REVENUE against — built
  // from invoices, not from job_orders, so a client the rep has raised
  // an order for but never invoiced doesn't show up here (matches "...
  // has revenue against" literally). Invoices with no client_id
  // (never linked to a real client record) are grouped into their own
  // explicit "No Client Linked" row rather than silently dropped, so
  // this table's totals always reconcile with the summary cards above.
  const clientBreakdown: ClientBreakdownRow[] = useMemo(() => {
    const map = new Map<number | null, ClientBreakdownRow>();
    for (const inv of filteredInvoices) {
      const key = inv.client_id;
      let row = map.get(key);
      if (!row) {
        row = {
          clientId: key,
          clientName: inv.clients?.name ?? "— No Client Linked —",
          totalRevenue: 0,
          collected: 0,
          outstanding: 0,
          jobCount: jobCountByClient.get(key) ?? 0,
        };
        map.set(key, row);
      }
      row.totalRevenue += inv.invoice_total;
      row.collected += inv.payment;
      row.outstanding += inv.balance;
    }
    // Actionable-first: who owes the most, per explicit instruction.
    return Array.from(map.values()).sort((a, b) => b.outstanding - a.outstanding);
  }, [filteredInvoices, jobCountByClient]);

  // Most-recent-first, both for display and so the activity CSV export
  // reflects the same order as what's on screen. Recent Activity is
  // filtered by the same range as the summary cards/breakdown above it —
  // otherwise a filtered "Total Revenue" sitting above an unfiltered
  // activity list would misleadingly look like it doesn't add up.
  const sortedInvoices = useMemo(
    () => [...filteredInvoices].sort((a, b) => b.date.localeCompare(a.date)),
    [filteredInvoices]
  );

  const monthGroups: MonthGroup<SalesInvoiceRow>[] = useMemo(
    () => groupByMonth(sortedInvoices, (r) => parseDateOnly(r.date)),
    [sortedInvoices]
  );
  const currentKey = currentMonthKey();

  function exportBreakdownCsv() {
    downloadCsv(
      "ATP_my_sales_client_breakdown",
      BREAKDOWN_COLUMNS,
      clientBreakdown.map((r) => [
        r.clientName,
        r.totalRevenue.toFixed(2),
        r.collected.toFixed(2),
        r.outstanding.toFixed(2),
        String(r.jobCount),
      ])
    );
  }

  function exportActivityCsv() {
    downloadCsv("ATP_my_sales_activity", ACTIVITY_COLUMNS, sortedInvoices.map(activityRowToCsv));
  }

  return (
    <div>
      <div className="mb-4 rounded-at-lg border border-at-border bg-at-white p-4 shadow-at-sm">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
              From Date
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
              To Date
            </label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </div>
          {hasRange && (
            <Button variant="secondary" onClick={clearRange}>
              Clear
            </Button>
          )}
          <div className="text-sm text-at-slate">
            {hasRange && rangeValid
              ? `Showing ${fromDate} to ${toDate} — invoices by invoice date, jobs by date raised.`
              : "Showing all-time (no date range applied)."}
          </div>
        </div>
        {hasRange && !rangeValid && (
          <div className="mt-2 text-sm font-semibold text-red-600">
            From Date must be on or before To Date — showing all-time until fixed.
          </div>
        )}
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="Total Revenue" value={money(totalRevenue)} />
        <SummaryCard label="Total Collected" value={money(totalCollected)} valueColor="#10b981" />
        <SummaryCard
          label="Total Outstanding"
          value={money(totalOutstanding)}
          valueColor={totalOutstanding > 0 ? "#ef4444" : "#10b981"}
        />
        <SummaryCard label="Total Jobs Raised" value={totalJobsRaised.toLocaleString()} />
      </div>

      <div className="mb-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="text-base font-bold text-at-navy">
            Client Breakdown — {repName}
          </div>
          <Button onClick={exportBreakdownCsv} disabled={clientBreakdown.length === 0}>
            <Download size={14} /> Download Client Breakdown CSV
          </Button>
        </div>

        {clientBreakdown.length === 0 ? (
          <div className="rounded-at-lg border border-at-border bg-at-white p-6 text-sm text-at-slate shadow-at-sm">
            No revenue attributed to {repName} yet.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-at-lg border border-at-border bg-at-white shadow-at-sm">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-at-border bg-at-bg">
                  {["Client", "Total Revenue", "Collected", "Outstanding", "Jobs"].map((col) => (
                    <th
                      key={col}
                      className={`whitespace-nowrap px-4 py-2.5 text-[0.7rem] font-bold uppercase tracking-wide text-at-slate ${
                        col === "Jobs" || col === "Total Revenue" || col === "Collected" || col === "Outstanding"
                          ? "text-right"
                          : ""
                      }`}
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {clientBreakdown.map((row) => (
                  <tr
                    key={row.clientId ?? "no-client"}
                    className="border-b border-at-border last:border-0 hover:bg-at-bg"
                  >
                    <td className="whitespace-nowrap px-4 py-2.5 font-semibold text-at-navy">{row.clientName}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right text-at-navy">
                      {money(row.totalRevenue)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right text-at-navy">{money(row.collected)}</td>
                    <td
                      className="whitespace-nowrap px-4 py-2.5 text-right font-bold"
                      style={{ color: row.outstanding > 0 ? "#ef4444" : "#10b981" }}
                    >
                      {money(row.outstanding)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right text-at-navy">{row.jobCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="text-base font-bold text-at-navy">Recent Activity</div>
          <Button onClick={exportActivityCsv} disabled={sortedInvoices.length === 0}>
            <Download size={14} /> Download Activity CSV
          </Button>
        </div>

        {sortedInvoices.length === 0 ? (
          <div className="rounded-at-lg border border-at-border bg-at-white p-6 text-sm text-at-slate shadow-at-sm">
            No invoices recorded against {repName} yet.
          </div>
        ) : (
          monthGroups.map((month) => (
            <CollapsibleMonthGroup
              key={month.key}
              monthLabel={month.label}
              itemCount={month.items.length}
              itemLabel="invoices"
              defaultExpanded={month.key === currentKey}
            >
              <div className="-mx-4 -my-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-at-border bg-at-bg">
                      {[
                        "Date",
                        "Order No.",
                        "Customer",
                        "Client",
                        "Category",
                        "Business Unit",
                        "Qty",
                        "Unit Price",
                        "Invoice Total",
                        "Payment",
                        "Balance",
                        "Status",
                      ].map((col) => (
                        <th
                          key={col}
                          className={`whitespace-nowrap px-4 py-2.5 text-[0.7rem] font-bold uppercase tracking-wide text-at-slate ${
                            ["Qty", "Unit Price", "Invoice Total", "Payment", "Balance"].includes(col)
                              ? "text-right"
                              : ""
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
                        <td className="whitespace-nowrap px-4 py-2.5 text-at-navy">{r.date}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-at-navy">{r.job_order_no || "—"}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 font-semibold text-at-navy">
                          {r.customer_name || "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-at-slate">{r.clients?.name || "—"}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-at-slate">{r.revenue_category}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-at-slate">{r.business_unit}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right text-at-navy">
                          {r.quantity.toLocaleString()}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right text-at-navy">
                          {money(r.unit_price)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right font-bold text-at-navy">
                          {money(r.invoice_total)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right text-at-navy">
                          {money(r.payment)}
                        </td>
                        <td
                          className="whitespace-nowrap px-4 py-2.5 text-right font-bold"
                          style={{ color: r.balance > 0 ? "#ef4444" : "#10b981" }}
                        >
                          {money(r.balance)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-at-slate">{r.status || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CollapsibleMonthGroup>
          ))
        )}
      </div>
    </div>
  );
}
