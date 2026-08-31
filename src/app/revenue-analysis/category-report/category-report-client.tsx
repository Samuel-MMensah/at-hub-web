"use client";

import { useMemo, useRef, useState } from "react";
import { Download, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CollapsibleMonthGroup } from "@/components/ui/collapsible-month-group";
import { groupByMonth, currentMonthKey, type MonthGroup } from "@/lib/month-groups";
import { createClient } from "@/lib/supabase/client";
import type { InvoiceRow, JobOrderOption } from "../invoice-entry/invoice-entry-client";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL;
const CURRENCY = "GH₵";

// Same 7 real values used by Invoice Entry's own Revenue Category
// dropdown and Revenue Analysis's REVENUE_CATEGORY_COLORS — not a
// fresh list.
const REVENUE_CATEGORIES = [
  "Large Format",
  "Screen Print",
  "Embroidery",
  "Digital Press",
  "Commercial Press",
  "Publishing",
  "Packaging",
] as const;

const REPORT_COLUMNS = [
  "Date",
  "Order No.",
  "Customer",
  "Category",
  "Product",
  "Business Unit",
  "Sales Rep",
  "Qty",
  "Amount (excl. tax)",
  "Amount (incl. tax)",
  "Payment",
  "Balance",
];
const RIGHT_ALIGNED_COLUMNS = new Set([
  "Qty",
  "Amount (excl. tax)",
  "Amount (incl. tax)",
  "Payment",
  "Balance",
]);

// "All Categories" is no longer a distinct filter value (the dropdown
// is gone) — selecting all 7 individually is functionally identical
// (categories.includes() matches everything), but the label/filename
// still reads "All Categories" in that case rather than a 7-item list,
// for continuity with the old single-select behavior.
function categoryLabel(categories: string[]): string {
  return categories.length === REVENUE_CATEGORIES.length ? "All Categories" : categories.join(", ");
}

function money(n: number): string {
  return `${CURRENCY}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// `date` is a plain Postgres DATE, not timestamptz — same reasoning
// already established for material_receipts/material_issuances.
function parseDateOnly(raw: string): Date {
  return new Date(raw);
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

// sales_rep is only stored directly on job_invoices for an UNLINKED
// entry (job_order_no IS NULL) — the sales_rep_only_when_unlinked CHECK
// constraint guarantees it's always null on a LINKED one, where the
// real salesperson lives on the linked job_orders row instead. Never
// just job_invoices.sales_rep on its own: that would read blank for
// every linked invoice even though a real salesperson exists.
function effectiveSalesRep(invoice: InvoiceRow, jobOrderSalesRepByNo: Map<string, string | null>): string {
  if (invoice.job_order_no) {
    return jobOrderSalesRepByNo.get(invoice.job_order_no) ?? "";
  }
  return invoice.sales_rep ?? "";
}

// Same downloadCsv shape as Audit Log/My Sales Dashboard/Revenue
// Analysis — duplicated locally per this codebase's established
// per-file convention, not a shared import.
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

// Blank for an unlinked invoice — never the literal "null"/"None".
function rowToCsv(r: InvoiceRow, jobOrderSalesRepByNo: Map<string, string | null>): string[] {
  return [
    r.date,
    r.job_order_no ?? "",
    r.customer_name ?? "",
    r.revenue_category,
    r.product_description ?? "",
    r.business_unit,
    effectiveSalesRep(r, jobOrderSalesRepByNo),
    String(r.quantity),
    r.amount.toFixed(2),
    r.invoice_total.toFixed(2),
    r.payment.toFixed(2),
    r.balance.toFixed(2),
  ];
}

type PdfState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; url: string; filename: string };

// Same async flow as PdfPreviewButton (components/ui/pdf-preview-button.tsx)
// — Bearer token from the real session, POST, blob preview + download —
// but a genuinely different request shape (category + date range, not a
// single order_id), so this is its own component rather than forcing
// that one to serve two different endpoints.
function CategoryReportPdfButton({
  categories,
  fromDate,
  toDate,
}: {
  categories: string[]; // always non-empty — Generate is disabled otherwise
  fromDate: string;
  toDate: string;
}) {
  const [state, setState] = useState<PdfState>({ status: "idle" });
  const activeUrlRef = useRef<string | null>(null);

  async function handleOpen() {
    setState({ status: "loading" });

    if (!BACKEND_URL) {
      setState({ status: "error", message: "Backend URL is not configured (NEXT_PUBLIC_BACKEND_URL)." });
      return;
    }

    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        setState({ status: "error", message: "Your session has expired — please sign in again." });
        return;
      }

      const res = await fetch(`${BACKEND_URL}/pdf/category-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ categories, from_date: fromDate, to_date: toDate }),
      });

      if (!res.ok) {
        let detail = `PDF generation failed (${res.status}).`;
        try {
          const body = await res.json();
          if (body?.detail) detail = body.detail;
        } catch {
          // response body wasn't JSON — keep the generic status message
        }
        setState({ status: "error", message: detail });
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      activeUrlRef.current = url;

      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="?([^"]+)"?/);
      const filename = match?.[1] ?? "CategoryReport.pdf";

      setState({ status: "ready", url, filename });
    } catch {
      setState({ status: "error", message: "Could not reach the PDF service — is the backend running?" });
    }
  }

  function handleClose() {
    if (activeUrlRef.current) {
      URL.revokeObjectURL(activeUrlRef.current);
      activeUrlRef.current = null;
    }
    setState({ status: "idle" });
  }

  function handleDownload() {
    if (state.status !== "ready") return;
    const link = document.createElement("a");
    link.href = state.url;
    link.download = state.filename;
    link.click();
  }

  return (
    <>
      <Button variant="secondary" onClick={handleOpen} disabled={state.status === "loading"}>
        {state.status === "loading" ? (
          "Generating PDF…"
        ) : (
          <>
            <FileText size={14} /> Export PDF
          </>
        )}
      </Button>

      {state.status === "error" && <div className="mt-2 text-sm font-semibold text-red-600">{state.message}</div>}

      {state.status === "ready" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="flex h-[85vh] w-full max-w-3xl flex-col rounded-at-lg bg-at-white shadow-at-md">
            <div className="flex items-center justify-between border-b border-at-border px-5 py-3">
              <div className="truncate text-sm font-bold text-at-navy">{state.filename}</div>
              <div className="flex shrink-0 items-center gap-2">
                <Button size="sm" onClick={handleDownload}>
                  Download
                </Button>
                <Button size="sm" variant="secondary" onClick={handleClose}>
                  Close
                </Button>
              </div>
            </div>
            <iframe src={state.url} title={state.filename} className="w-full flex-1 rounded-b-lg border-0" />
          </div>
        </div>
      )}
    </>
  );
}

export function CategoryReportClient({
  invoices,
  jobOrders,
}: {
  invoices: InvoiceRow[];
  jobOrders: JobOrderOption[];
}) {
  const [categories, setCategories] = useState<string[]>([]);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [dateError, setDateError] = useState<string | null>(null);
  const [generated, setGenerated] = useState(false);
  const [reportRows, setReportRows] = useState<InvoiceRow[]>([]);

  // O(1) lookup for effectiveSalesRep()'s join-through on linked
  // invoices — built once per jobOrders change, not per row.
  const jobOrderSalesRepByNo = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const o of jobOrders) map.set(o.job_order_no, o.sales_rep);
    return map;
  }, [jobOrders]);

  const canGenerate = fromDate !== "" && toDate !== "" && categories.length > 0;

  function toggleCategory(cat: string) {
    setCategories((prev) => (prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]));
  }

  function handleGenerate() {
    setDateError(null);
    if (!canGenerate) return;
    if (fromDate > toDate) {
      setDateError("From Date must be on or before To Date.");
      return;
    }
    const filtered = invoices.filter((r) => {
      if (r.date < fromDate || r.date > toDate) return false;
      if (!categories.includes(r.revenue_category)) return false;
      return true;
    });
    // Chronological — a report reads top-to-bottom in date order, same
    // convention as every other export in this app.
    filtered.sort((a, b) => a.date.localeCompare(b.date));
    setReportRows(filtered);
    setGenerated(true);
  }

  const monthGroups: MonthGroup<InvoiceRow>[] = useMemo(
    () => groupByMonth(reportRows, (r) => parseDateOnly(r.date)),
    [reportRows]
  );
  const currentKey = currentMonthKey();

  const totalAmount = reportRows.reduce((sum, r) => sum + r.amount, 0);
  const totalInvoiceTotal = reportRows.reduce((sum, r) => sum + r.invoice_total, 0);
  // Not clamped — matches this app's own convention (Invoice History,
  // Dispatch): balance is a real signed figure, never force-corrected
  // to zero at read/summary time.
  const totalOutstanding = reportRows.reduce((sum, r) => sum + r.balance, 0);

  function exportCsv() {
    downloadCsv(
      `ATP_category_report_${categoryLabel(categories).replace(/[^a-z0-9]+/gi, "_")}`,
      REPORT_COLUMNS,
      reportRows.map((r) => rowToCsv(r, jobOrderSalesRepByNo))
    );
  }

  return (
    <div>
      <div className="rounded-at-lg border border-at-border bg-at-white p-6 shadow-at-sm">
        <div className="mb-4 text-base font-bold text-at-navy">Category Report</div>

        {/* Multi-select pill toggle, same convention as Audit Log's own
            status filter (audit-log-client.tsx) — not a fresh UI pattern.
            No explicit "All Categories" option anymore: picking all 7
            individually produces the same filtered result (see
            categoryLabel() above for the matching label/filename
            equivalence). */}
        <div className="mb-4">
          <label className="mb-1 block text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
            Categories
          </label>
          <div className="flex flex-wrap gap-2">
            {REVENUE_CATEGORIES.map((c) => {
              const active = categories.includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggleCategory(c)}
                  className={`rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors ${
                    active
                      ? "border-at-navy bg-at-navy text-at-white"
                      : "border-at-border bg-at-white text-at-slate hover:border-at-accent"
                  }`}
                >
                  {c}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
              From Date
            </label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
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
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </div>
        </div>

        {dateError && <div className="mb-3 text-sm font-semibold text-red-600">{dateError}</div>}

        <Button disabled={!canGenerate} onClick={handleGenerate}>
          Generate Report
        </Button>
      </div>

      {generated && (
        <div className="mt-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-at-slate">
              <strong className="text-at-navy">{reportRows.length}</strong> invoice
              {reportRows.length === 1 ? "" : "s"} · {categoryLabel(categories)} · {fromDate} to {toDate} · Amount
              (excl. tax): <strong className="text-at-navy">{money(totalAmount)}</strong> · Amount (incl. tax):{" "}
              <strong className="text-at-navy">{money(totalInvoiceTotal)}</strong> · Outstanding:{" "}
              <strong style={{ color: totalOutstanding > 0 ? "#ef4444" : "#10b981" }}>
                {money(totalOutstanding)}
              </strong>
            </div>
            {reportRows.length > 0 && (
              <div className="flex gap-2">
                <Button variant="secondary" onClick={exportCsv}>
<Download size={14} /> Export CSV
                </Button>
                <CategoryReportPdfButton categories={categories} fromDate={fromDate} toDate={toDate} />
              </div>
            )}
          </div>

          {reportRows.length === 0 ? (
            <div className="rounded-at-lg border border-at-border bg-at-white p-6 text-sm text-at-slate shadow-at-sm">
              No invoices match this category / date range.
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
                        {REPORT_COLUMNS.map((col) => (
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
                          <td className="whitespace-nowrap px-4 py-2.5 text-at-navy">{r.date}</td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-at-navy">{r.job_order_no ?? ""}</td>
                          <td className="whitespace-nowrap px-4 py-2.5 font-semibold text-at-navy">
                            {r.customer_name ?? ""}
                          </td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-at-slate">{r.revenue_category}</td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-at-slate">
                            {r.product_description ?? ""}
                          </td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-at-slate">{r.business_unit}</td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-at-slate">
                            {effectiveSalesRep(r, jobOrderSalesRepByNo) || "—"}
                          </td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-right text-at-navy">
                            {r.quantity.toLocaleString()}
                          </td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-right text-at-navy">
                            {money(r.amount)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-right font-semibold text-at-navy">
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
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CollapsibleMonthGroup>
            ))
          )}
        </div>
      )}
    </div>
  );
}
