"use client";

import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { CollapsibleMonthGroup } from "@/components/ui/collapsible-month-group";
import { currentMonthKey, groupByMonth, type MonthGroup } from "@/lib/month-groups";
import { recordInvoice } from "./actions";

const CURRENCY = "GH₵";

const REVENUE_CATEGORIES = [
  "Large Format",
  "Screen Print",
  "Embroidery",
  "Digital Press",
  "Commercial Press",
  "Publishing",
  "Packaging",
] as const;

// Uppercase, matching the real stored values / CHECK constraint —
// not the title-case used earlier in conversation.
const BUSINESS_UNITS = ["WALK-IN", "PRIVATE", "GOVERNMENT", "SUBSIDIARY"] as const;

export interface JobOrderOption {
  job_order_no: string;
  customer_name: string;
  status: string | null;
  qty_to_print: number | null;
  total_amount: number | null;
}

export interface InvoiceRow {
  id: number;
  date: string;
  job_order_no: string | null;
  customer_name: string | null;
  product_description: string | null;
  revenue_category: string;
  business_unit: string;
  quantity: number;
  unit_price: number;
  amount: number;
  nhil: number;
  vat: number;
  invoice_total: number;
  payment: number;
  balance: number;
  status: string | null;
  oracle_no: string | null;
}

function money(n: number): string {
  return `${CURRENCY}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// `date` is a plain Postgres DATE, not timestamptz — same reasoning
// already established for material_receipts/material_issuances.
function parseDateOnly(raw: string): Date {
  return new Date(raw);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function InvoiceEntryClient({
  jobOrders,
  invoices,
}: {
  jobOrders: JobOrderOption[];
  invoices: InvoiceRow[];
}) {
  const monthGroups: MonthGroup<InvoiceRow>[] = useMemo(
    () => groupByMonth(invoices, (r) => parseDateOnly(r.date)),
    [invoices]
  );
  const currentKey = currentMonthKey();

  return (
    <div>
      <InvoiceForm jobOrders={jobOrders} />

      <div className="mb-3 mt-8 border-t-2 border-slate-100 pt-6 text-base font-bold text-at-navy">
        Invoice History
      </div>

      {invoices.length === 0 ? (
        <div className="rounded-at-lg border border-at-border bg-at-white p-6 text-sm text-at-slate shadow-at-sm">
          No invoices recorded yet.
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
                      "Product",
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
                      <td className="whitespace-nowrap px-4 py-2.5 text-at-slate">{r.product_description || "—"}</td>
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
                      <td className="whitespace-nowrap px-4 py-2.5 text-right text-at-navy">{money(r.payment)}</td>
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
  );
}

function InvoiceForm({ jobOrders }: { jobOrders: JobOrderOption[] }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [date, setDate] = useState(todayIso());

  const [orderSearch, setOrderSearch] = useState("");
  const [selectedOrderNo, setSelectedOrderNo] = useState("");

  const [customerName, setCustomerName] = useState("");
  const [productDescription, setProductDescription] = useState("");
  const [revenueCategory, setRevenueCategory] = useState<string>("");
  const [businessUnit, setBusinessUnit] = useState<string>("");
  const [quantity, setQuantity] = useState<number | "">("");
  const [unitPrice, setUnitPrice] = useState<number | "">("");
  const [exempt, setExempt] = useState(false);
  const [payment, setPayment] = useState<number | "">(0);
  const [status, setStatus] = useState<string>("");
  const [oracleNo, setOracleNo] = useState("");

  const orderCandidates = useMemo(() => {
    const q = orderSearch.trim().toLowerCase();
    if (!q) return jobOrders;
    return jobOrders.filter(
      (o) => o.job_order_no.toLowerCase().includes(q) || (o.customer_name ?? "").toLowerCase().includes(q)
    );
  }, [jobOrders, orderSearch]);

  function handleSelectOrder(orderNo: string) {
    setSelectedOrderNo(orderNo);
    if (!orderNo) return;
    const order = jobOrders.find((o) => o.job_order_no === orderNo);
    if (!order) return;
    // Auto-fill, not lock — every field set here stays editable below,
    // same "auto-fill from source, never locked" pattern already used
    // for Unit Cost (Material Receipts) and Customer Name (Material
    // Issuance). unitPrice is back-derived from the order's real
    // total_amount so quantity * unitPrice reproduces that total_amount
    // exactly at the moment of linking — not because amount is
    // separately stored, but because amount is ALWAYS
    // quantity * unitPrice (confirmed against all 172 existing rows,
    // zero exceptions), so this is the only way to "start equal to the
    // real order value by construction" without a second amount field.
    setCustomerName(order.customer_name ?? "");
    const qty = order.qty_to_print ?? 0;
    setQuantity(qty);
    setUnitPrice(qty > 0 ? (order.total_amount ?? 0) / qty : 0);
  }

  const numericQuantity = typeof quantity === "number" ? quantity : 0;
  const numericUnitPrice = typeof unitPrice === "number" ? unitPrice : 0;
  const amount = numericQuantity * numericUnitPrice;
  const nhil = exempt ? 0 : amount * 0.05;
  const vat = exempt ? 0 : amount * 0.15;
  const invoiceTotal = amount + nhil + vat;

  const canSubmit =
    date !== "" &&
    revenueCategory !== "" &&
    businessUnit !== "" &&
    typeof quantity === "number" &&
    quantity > 0 &&
    typeof unitPrice === "number" &&
    unitPrice >= 0 &&
    typeof payment === "number" &&
    payment >= 0;

  function handleSubmit() {
    if (!canSubmit || typeof quantity !== "number" || typeof unitPrice !== "number" || typeof payment !== "number") {
      return;
    }
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await recordInvoice({
        date,
        jobOrderNo: selectedOrderNo || null,
        customerName,
        productDescription,
        revenueCategory,
        businessUnit,
        quantity,
        unitPrice,
        exempt,
        payment,
        status: status || null,
        oracleNo,
      });
      if (result.error) {
        setError(result.error);
      } else {
        setSuccess(`Invoice recorded: ${money(invoiceTotal)} — ${customerName || "no customer name"}.`);
        setSelectedOrderNo("");
        setOrderSearch("");
        setCustomerName("");
        setProductDescription("");
        setRevenueCategory("");
        setBusinessUnit("");
        setQuantity("");
        setUnitPrice("");
        setExempt(false);
        setPayment(0);
        setStatus("");
        setOracleNo("");
      }
    });
  }

  return (
    <div className="rounded-at-lg border border-at-border bg-at-white p-6 shadow-at-sm">
      <div className="mb-4 text-base font-bold text-at-navy">Record an Invoice</div>

      <div className="mb-4">
        <label className="mb-1 block text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
          Date
        </label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-full max-w-xs rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
        />
      </div>

      <div className="mb-4">
        <label className="mb-1 block text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
          Job Order (optional)
        </label>
        <input
          type="text"
          value={orderSearch}
          onChange={(e) => setOrderSearch(e.target.value)}
          placeholder="Search by order number or customer name — any status"
          className="mb-2 w-full rounded-at border border-at-border bg-at-white px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
        />
        <select
          value={selectedOrderNo}
          onChange={(e) => handleSelectOrder(e.target.value)}
          className="w-full rounded-at border border-at-border bg-at-white px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
        >
          <option value="">— No linked order (standalone entry) —</option>
          {orderCandidates.map((o) => (
            <option key={o.job_order_no} value={o.job_order_no}>
              {o.job_order_no} — {o.customer_name || "—"} · {o.status || "—"}
            </option>
          ))}
        </select>
        {orderCandidates.length === 0 && (
          <div className="mt-2 text-sm text-at-slate">No orders match your search.</div>
        )}
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
            Customer Name
          </label>
          <input
            type="text"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="optional"
            className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
          />
        </div>
        <div>
          <label className="mb-1 block text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
            Product Description
          </label>
          <input
            type="text"
            value={productDescription}
            onChange={(e) => setProductDescription(e.target.value)}
            placeholder="optional"
            className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
          />
        </div>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
            Revenue Category
          </label>
          <select
            value={revenueCategory}
            onChange={(e) => setRevenueCategory(e.target.value)}
            className="w-full rounded-at border border-at-border bg-at-white px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
          >
            <option value="">— Select —</option>
            {REVENUE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
            Business Unit
          </label>
          <select
            value={businessUnit}
            onChange={(e) => setBusinessUnit(e.target.value)}
            className="w-full rounded-at border border-at-border bg-at-white px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
          >
            <option value="">— Select —</option>
            {BUSINESS_UNITS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
            Quantity
          </label>
          <input
            type="number"
            min={1}
            step={1}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value === "" ? "" : Number(e.target.value))}
            className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
          />
        </div>
        <div>
          <label className="mb-1 block text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
            Unit Price ({CURRENCY})
          </label>
          <input
            type="number"
            min={0}
            step={0.01}
            value={unitPrice}
            onChange={(e) => setUnitPrice(e.target.value === "" ? "" : Number(e.target.value))}
            className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
          />
        </div>
      </div>

      {/* NHIL/VAT/Invoice Total are read-only, live-computed preview —
          5%/15%/sum, matching the formula confirmed against 164 of the
          172 real imported rows. The other 8 are legitimately exempt
          (nhil=0, vat=0 in the real data) — this checkbox is the only
          way to represent that real case without silently making it
          impossible to enter through this form. */}
      <div className="mb-4">
        <label className="flex items-center gap-2 text-sm text-at-navy">
          <input type="checkbox" checked={exempt} onChange={(e) => setExempt(e.target.checked)} />
          Exempt from NHIL/VAT
        </label>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 rounded-at border border-at-border bg-at-bg p-3 sm:grid-cols-3">
        <div>
          <div className="text-[0.65rem] font-bold uppercase tracking-wide text-at-slate">NHIL (5%)</div>
          <div className="text-sm font-semibold text-at-navy">{money(nhil)}</div>
        </div>
        <div>
          <div className="text-[0.65rem] font-bold uppercase tracking-wide text-at-slate">VAT (15%)</div>
          <div className="text-sm font-semibold text-at-navy">{money(vat)}</div>
        </div>
        <div>
          <div className="text-[0.65rem] font-bold uppercase tracking-wide text-at-slate">Invoice Total</div>
          <div className="text-sm font-extrabold text-at-navy">{money(invoiceTotal)}</div>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
            Payment ({CURRENCY})
          </label>
          <input
            type="number"
            min={0}
            step={0.01}
            value={payment}
            onChange={(e) => setPayment(e.target.value === "" ? "" : Number(e.target.value))}
            className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
          />
        </div>
        <div>
          <label className="mb-1 block text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
            Status
          </label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="w-full rounded-at border border-at-border bg-at-white px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
          >
            <option value="">— Unset —</option>
            <option value="DELIVERED">DELIVERED</option>
            <option value="IN PRODUCTION">IN PRODUCTION</option>
          </select>
        </div>
      </div>

      <div className="mb-4">
        <label className="mb-1 block text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
          Oracle No.
        </label>
        <input
          type="text"
          value={oracleNo}
          onChange={(e) => setOracleNo(e.target.value)}
          placeholder="optional"
          className="w-full max-w-xs rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
        />
      </div>

      {error && <div className="mb-3 text-sm font-semibold text-red-600">{error}</div>}
      {success && <div className="mb-3 text-sm font-semibold text-emerald-600">{success}</div>}

      <Button disabled={!canSubmit || isPending} onClick={handleSubmit}>
        Record Invoice
      </Button>
    </div>
  );
}
