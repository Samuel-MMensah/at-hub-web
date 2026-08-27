"use client";

import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { CollapsibleMonthGroup } from "@/components/ui/collapsible-month-group";
import { currentMonthKey, groupByMonth, type MonthGroup } from "@/lib/month-groups";
import { recordInvoice, recordInvoicePayment, updateInvoice } from "./actions";
import type { SalesRepOption } from "@/lib/sales-reps";

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
// not the title-case used earlier in conversation. SAMPLE/CSR/REPLACEMENT
// added 2026-08-15 alongside the CHECK constraint migration that
// introduced them (supabase/migrations/20260815090000_...) — must match
// actions.ts's own copy of this list exactly, or the dropdown offers a
// value the server-side validation there will reject.
const BUSINESS_UNITS = ["WALK-IN", "PRIVATE", "GOVERNMENT", "SUBSIDIARY", "SAMPLE", "CSR", "REPLACEMENT"] as const;

export interface JobOrderOption {
  job_order_no: string;
  customer_name: string;
  status: string | null;
  qty_to_print: number | null;
  total_amount: number | null;
  client_id: number | null;
  // The real salesperson for a LINKED invoice (job_invoices.sales_rep is
  // always null in that case — enforced by sales_rep_only_when_unlinked)
  // — added for Category Report's Sales Rep column, which joins through
  // to this field via job_order_no.
  sales_rep: string | null;
}

// Phase 1/2's clients table — identity/contact only, no ownership.
export interface ClientOption {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
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
  client_id: number | null;
  sales_rep: string | null;
  edited_by: string | null;
  edited_at: string | null;
}

function money(n: number): string {
  return `${CURRENCY}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// `date` is a plain Postgres DATE, not timestamptz — same reasoning
// already established for material_receipts/material_issuances.
function parseDateOnly(raw: string): Date {
  return new Date(raw);
}

// Historical rows carry real float residue (e.g. 0.00039999999998995918
// for a balance that's actually zero) — every balance this section
// displays, pre-fills, or reasons about goes through this first, so a
// residue row reads and behaves as the GH₵0.00 it really is, not as a
// tiny nonzero amount someone could accidentally "pay".
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// Same pattern as material-receipts-client.tsx's EditedBadge — small,
// subtle indicator that a row isn't in its original state; title
// attribute carries the full precision (who + exact timestamp) since
// the visible badge itself only has room for a short date.
function EditedBadge({ editedBy, editedAt }: { editedBy: string | null; editedAt: string | null }) {
  if (!editedAt) return null;
  const d = new Date(editedAt);
  const short = d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return (
    <span
      title={`Edited by ${editedBy ?? "unknown"} on ${d.toLocaleString()}`}
      className="ml-2 inline-block whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-[0.65rem] font-semibold text-amber-800"
    >
      edited {short}
    </span>
  );
}

export function InvoiceEntryClient({
  jobOrders,
  invoices,
  clients,
  salesReps,
  initialOrderNo,
}: {
  jobOrders: JobOrderOption[];
  invoices: InvoiceRow[];
  clients: ClientOption[];
  salesReps: SalesRepOption[];
  // Deep-link from Uninvoiced Orders (?order=P123456) — pre-selects
  // this order in the form below, same friction-reducing intent as
  // raise-order's own ?resubmit= deep-link.
  initialOrderNo?: string;
}) {
  const monthGroups: MonthGroup<InvoiceRow>[] = useMemo(
    () => groupByMonth(invoices, (r) => parseDateOnly(r.date)),
    [invoices]
  );
  const currentKey = currentMonthKey();

  // Same edit-in-place pattern as material-receipts-client.tsx: a
  // selected row's id drives which invoice InvoiceForm pre-fills as an
  // edit, the parent forces a remount via key={editingInvoice?.id ??
  // "new"} so the form's own useState initializers only need to run
  // once per "which row", and onSaved/onCancelEdit both just clear the
  // selection to fall back to create mode.
  const [editingId, setEditingId] = useState<number | null>(null);
  const editingInvoice = invoices.find((r) => r.id === editingId) ?? null;

  function handleEditClick(id: number) {
    setEditingId(id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div>
      <InvoiceForm
        key={editingInvoice?.id ?? "new"}
        jobOrders={jobOrders}
        clients={clients}
        salesReps={salesReps}
        initialOrderNo={initialOrderNo}
        editingInvoice={editingInvoice}
        onCancelEdit={() => setEditingId(null)}
        onSaved={() => setEditingId(null)}
      />

      <RecordPaymentSection invoices={invoices} />

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
                      "",
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
                      <td className="whitespace-nowrap px-4 py-2.5 text-at-navy">
                        {r.date}
                        <EditedBadge editedBy={r.edited_by} editedAt={r.edited_at} />
                      </td>
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
                      <td className="whitespace-nowrap px-4 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => handleEditClick(r.id)}
                          className="text-xs font-semibold text-at-accent hover:underline"
                        >
                          Edit
                        </button>
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

// Shared by both the manual dropdown pick (handleSelectOrder) and the
// ?order= deep-link initial-state derivation, so the two paths can
// never drift apart. unitPrice is back-derived from the order's real
// total_amount so quantity * unitPrice reproduces that total_amount
// exactly at the moment of linking — not because amount is separately
// stored, but because amount is ALWAYS quantity * unitPrice (confirmed
// against all 172 existing rows, zero exceptions).
function orderAutoFill(order: JobOrderOption) {
  const qty = order.qty_to_print ?? 0;
  return {
    customerName: order.customer_name ?? "",
    quantity: qty,
    unitPrice: qty > 0 ? (order.total_amount ?? 0) / qty : 0,
    selectedClientId: order.client_id ?? ("" as number | ""),
    salesRep: "",
  };
}

interface InvoiceFormProps {
  jobOrders: JobOrderOption[];
  clients: ClientOption[];
  salesReps: SalesRepOption[];
  initialOrderNo?: string;
  editingInvoice?: InvoiceRow | null;
  onCancelEdit?: () => void;
  onSaved?: () => void;
}

// Reused for both create and edit — not a second form component, same
// "one form, driven by an optional editing row" pattern already
// established for material-receipts-client.tsx's ReceiptForm. The
// parent forces a remount (key={editingInvoice?.id ?? "new"}) whenever
// the selected row changes, so every useState initializer below only
// needs to run once per "which invoice", not react to prop changes.
function InvoiceForm({
  jobOrders,
  clients,
  salesReps,
  initialOrderNo,
  editingInvoice = null,
  onCancelEdit,
  onSaved,
}: InvoiceFormProps) {
  const isEditing = editingInvoice !== null;
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [date, setDate] = useState(() => editingInvoice?.date ?? todayIso());

  // Deep-link pre-fill from Uninvoiced Orders (?order=P123456) — only
  // relevant when there's no invoice already being edited; editing an
  // existing invoice always wins over a stale ?order= param from
  // whatever link got the user here.
  const initialOrder =
    !editingInvoice && initialOrderNo ? jobOrders.find((o) => o.job_order_no === initialOrderNo) : undefined;
  const initialFill = initialOrder ? orderAutoFill(initialOrder) : null;

  const [orderSearch, setOrderSearch] = useState(
    () => editingInvoice?.job_order_no ?? initialOrder?.job_order_no ?? ""
  );
  const [selectedOrderNo, setSelectedOrderNo] = useState(
    () => editingInvoice?.job_order_no ?? initialOrder?.job_order_no ?? ""
  );

  const [customerName, setCustomerName] = useState(
    () => editingInvoice?.customer_name ?? initialFill?.customerName ?? ""
  );
  const [productDescription, setProductDescription] = useState(() => editingInvoice?.product_description ?? "");
  const [revenueCategory, setRevenueCategory] = useState<string>(() => editingInvoice?.revenue_category ?? "");
  const [businessUnit, setBusinessUnit] = useState<string>(() => editingInvoice?.business_unit ?? "");
  const [quantity, setQuantity] = useState<number | "">(() => editingInvoice?.quantity ?? initialFill?.quantity ?? "");
  const [unitPrice, setUnitPrice] = useState<number | "">(
    () => editingInvoice?.unit_price ?? initialFill?.unitPrice ?? ""
  );
  // No stored `exempt` column — reconstructed the same way this codebase
  // already reasons about the 8 real historical exempt rows: nhil=0 AND
  // vat=0 on the existing invoice means it was recorded exempt.
  const [exempt, setExempt] = useState(() => (editingInvoice ? editingInvoice.nhil === 0 && editingInvoice.vat === 0 : false));
  // payment is create-only — never pre-filled from editingInvoice, never
  // sent by updateInvoice; Record Payment remains the only place that
  // changes it (confirmed decision, see actions.ts).
  const [payment, setPayment] = useState<number | "">(0);
  const [status, setStatus] = useState<string>(() => editingInvoice?.status ?? "");
  const [oracleNo, setOracleNo] = useState(() => editingInvoice?.oracle_no ?? "");
  // Warning-gate acknowledgement for editing an invoice that already has
  // payment recorded — resets to false on every remount (a fresh row
  // selection, or switching back to create mode), never carried over.
  const [warningAcknowledged, setWarningAcknowledged] = useState(false);

  // Phase 3: client_id (real FK) + sales_rep. sales_rep is ONLY
  // meaningful/shown when this invoice is standalone (no linked job
  // order) — a linked invoice's attribution comes from that order's
  // own sales_rep via the join, never a second copy here, enforced by
  // the sales_rep_only_when_unlinked CHECK constraint (and re-checked
  // server-side in recordInvoice, not just hidden in this form).
  const [clientSearch, setClientSearch] = useState("");
  const [selectedClientId, setSelectedClientId] = useState<number | "">(
    () => editingInvoice?.client_id ?? initialFill?.selectedClientId ?? ""
  );
  const [salesRep, setSalesRep] = useState(() => editingInvoice?.sales_rep ?? initialFill?.salesRep ?? "");

  const orderCandidates = useMemo(() => {
    const q = orderSearch.trim().toLowerCase();
    if (!q) return jobOrders;
    return jobOrders.filter(
      (o) => o.job_order_no.toLowerCase().includes(q) || (o.customer_name ?? "").toLowerCase().includes(q)
    );
  }, [jobOrders, orderSearch]);

  const clientCandidates = useMemo(() => {
    const q = clientSearch.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((c) => c.name.toLowerCase().includes(q));
  }, [clients, clientSearch]);

  function handleSelectOrder(orderNo: string) {
    setSelectedOrderNo(orderNo);
    if (!orderNo) {
      // Reverting to a standalone entry — client/sales rep go back to
      // blank, pending a manual pick below (they're not carried over
      // from whatever the order had).
      setSelectedClientId("");
      setSalesRep("");
      return;
    }
    const order = jobOrders.find((o) => o.job_order_no === orderNo);
    if (!order) return;
    // Auto-fill, not lock — every field set here stays editable below,
    // same "auto-fill from source, never locked" pattern already used
    // for Unit Cost (Material Receipts) and Customer Name (Material
    // Issuance). Shared with the initial-render deep-link pre-fill
    // above via orderAutoFill(), so a manual dropdown pick and a
    // ?order= deep link produce identical results.
    const fill = orderAutoFill(order);
    setCustomerName(fill.customerName);
    setQuantity(fill.quantity);
    setUnitPrice(fill.unitPrice);
    // client_id comes straight from the order's own real FK — not a
    // name match. No picker shown for this case (see JSX below); it's
    // silently carried through to submission. sales_rep is cleared —
    // hidden/not applicable while linked.
    setSelectedClientId(fill.selectedClientId);
    setSalesRep(fill.salesRep);
  }

  const numericQuantity = typeof quantity === "number" ? quantity : 0;
  const numericUnitPrice = typeof unitPrice === "number" ? unitPrice : 0;
  const amount = numericQuantity * numericUnitPrice;
  const nhil = exempt ? 0 : amount * 0.05;
  const vat = exempt ? 0 : amount * 0.15;
  const invoiceTotal = amount + nhil + vat;

  // Warning gate: editing an invoice that already has a real payment
  // recorded requires acknowledging that changing the amount can leave
  // that payment inconsistent with the new total (confirmed decision —
  // see updateInvoice in actions.ts for the actual mechanics this warns
  // about). round2'd, matching every other payment-residue check in
  // this file — a float-residue near-zero payment doesn't spuriously
  // trigger the gate.
  const hasExistingPayment = isEditing && round2(editingInvoice.payment) > 0;

  const canSubmit =
    date !== "" &&
    revenueCategory !== "" &&
    businessUnit !== "" &&
    typeof quantity === "number" &&
    quantity > 0 &&
    typeof unitPrice === "number" &&
    unitPrice >= 0 &&
    (isEditing || (typeof payment === "number" && payment >= 0)) &&
    (!hasExistingPayment || warningAcknowledged);

  function handleSubmit() {
    if (!canSubmit || typeof quantity !== "number" || typeof unitPrice !== "number") {
      return;
    }
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const sharedFields = {
        date,
        jobOrderNo: selectedOrderNo || null,
        customerName,
        clientId: selectedClientId === "" ? null : selectedClientId,
        // Only ever sent when standalone — recordInvoice/updateInvoice
        // re-null it server-side anyway if jobOrderNo is set, but the
        // form shouldn't even offer to send a value that can't be used.
        salesRep: selectedOrderNo ? null : salesRep || null,
        productDescription,
        revenueCategory,
        businessUnit,
        quantity,
        unitPrice,
        exempt,
        status: status || null,
        oracleNo,
      };

      const result =
        isEditing && editingInvoice
          ? await updateInvoice(editingInvoice.id, sharedFields)
          : await recordInvoice({ ...sharedFields, payment: typeof payment === "number" ? payment : 0 });

      if (result.error) {
        setError(result.error);
      } else if (isEditing) {
        onSaved?.();
      } else {
        setSuccess(`Invoice recorded: ${money(invoiceTotal)} — ${customerName || "no customer name"}.`);
        setSelectedOrderNo("");
        setOrderSearch("");
        setCustomerName("");
        setClientSearch("");
        setSelectedClientId("");
        setSalesRep("");
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
      <div className="mb-4 flex items-center justify-between">
        <div className="text-base font-bold text-at-navy">
          {isEditing ? `Edit Invoice — ${editingInvoice.customer_name || "—"}` : "Record an Invoice"}
        </div>
        {isEditing && (
          <button
            type="button"
            onClick={onCancelEdit}
            className="text-xs font-semibold text-at-slate hover:text-at-navy"
          >
            Cancel
          </button>
        )}
      </div>

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

      {/* Client + sales rep — only shown for a standalone entry. Once a
          job order is linked, client_id is silently carried through
          from that order's own real FK (see handleSelectOrder) and
          sales_rep stays null — attribution comes from the order via
          the join, never a second copy here (sales_rep_only_when_unlinked). */}
      {!selectedOrderNo && (
        <div className="mb-4">
          <label className="mb-1 block text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
            Client (optional)
          </label>
          <input
            type="text"
            value={clientSearch}
            onChange={(e) => setClientSearch(e.target.value)}
            placeholder="Search by client name..."
            className="mb-2 w-full rounded-at border border-at-border bg-at-white px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
          />
          <select
            value={selectedClientId}
            onChange={(e) => setSelectedClientId(e.target.value === "" ? "" : Number(e.target.value))}
            className="w-full rounded-at border border-at-border bg-at-white px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
          >
            <option value="">— No client selected —</option>
            {clientCandidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.phone ? ` — ${c.phone}` : ""}
              </option>
            ))}
          </select>
          {clientCandidates.length === 0 && clientSearch.trim() && (
            <div className="mt-2 text-sm text-at-slate">No clients match your search.</div>
          )}

          <label className="mb-1 mt-3 block text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
            Sales / Marketing Rep (who brought this job)
          </label>
          <select
            value={salesRep}
            onChange={(e) => setSalesRep(e.target.value)}
            className="w-full rounded-at border border-at-border bg-at-white px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
          >
            <option value="">— None / Walk-in —</option>
            {salesReps.map((r) => (
              <option key={r.full_name} value={r.full_name}>
                {r.full_name}
              </option>
            ))}
          </select>
        </div>
      )}

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
        {/* Payment is create-only — editing an existing invoice never
            shows or changes it; Record Payment (below, on the History
            table's rows) remains the only place that does. */}
        {!isEditing && (
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
        )}
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

      {/* Warning gate — confirmed decision: editing an invoice that
          already has payment > 0 must not silently let quantity/price
          changes drift the total away from what was actually paid. Save
          stays disabled (see canSubmit) until this is acknowledged. */}
      {hasExistingPayment && (
        <div className="mb-4 rounded-lg border border-amber-300 border-l-4 border-l-amber-600 bg-gradient-to-br from-amber-50 to-amber-100 px-4 py-3">
          <div className="mb-1 text-[0.72rem] font-bold uppercase tracking-wide text-amber-800">
            ⚠️ Payment Already Recorded
          </div>
          <div className="mb-2 text-sm text-amber-900">
            This invoice already has {money(round2(editingInvoice.payment))} recorded as paid. Changing the
            amount may make the payment inconsistent with the new total.
          </div>
          <label className="flex items-center gap-2 text-sm text-amber-900">
            <input
              type="checkbox"
              checked={warningAcknowledged}
              onChange={(e) => setWarningAcknowledged(e.target.checked)}
            />
            I understand — save anyway
          </label>
        </div>
      )}

      {error && <div className="mb-3 text-sm font-semibold text-red-600">{error}</div>}
      {success && <div className="mb-3 text-sm font-semibold text-emerald-600">{success}</div>}

      <Button disabled={!canSubmit || isPending} onClick={handleSubmit}>
        {isEditing ? "Save Changes" : "Record Invoice"}
      </Button>
    </div>
  );
}

// Search+select over EXISTING invoices, same pattern as Archive's
// ManageArchivedOrders (archive-client.tsx) — search box narrowing a
// dropdown of candidates from data already fetched for the history
// table above (no new query), select one to open its payment panel.
// Keyed by `id` (a real unique PK), not job_order_no like Archive's
// version — most job_invoices rows have no job_order_no at all
// (172 imported historical rows, all NULL), and even linked ones
// aren't guaranteed unique per order in this table the way Archive's
// source table happens to be.
function RecordPaymentSection({ invoices }: { invoices: InvoiceRow[] }) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | "">("");

  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return invoices;
    return invoices.filter((inv) => {
      const customer = (inv.customer_name ?? "").toLowerCase();
      const orderNo = (inv.job_order_no ?? "").toLowerCase();
      return customer.includes(q) || orderNo.includes(q);
    });
  }, [invoices, search]);

  const target = selectedId === "" ? null : invoices.find((inv) => inv.id === selectedId) ?? null;

  return (
    <div className="mt-8 border-t-2 border-slate-100 pt-6">
      <div className="mb-3 text-base font-bold text-at-navy">Record Payment</div>

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by customer name or order number"
        className="mb-3 w-full rounded-at border border-at-border bg-at-white px-4 py-2.5 text-sm text-at-navy outline-none focus:border-at-accent"
      />

      <select
        value={selectedId}
        onChange={(e) => setSelectedId(e.target.value === "" ? "" : Number(e.target.value))}
        className="w-full max-w-xl rounded-at border border-at-border bg-at-white px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
      >
        <option value="">— Select an invoice —</option>
        {candidates.map((inv) => (
          <option key={inv.id} value={inv.id}>
            {inv.date} — {inv.customer_name || "—"}
            {inv.job_order_no ? ` (${inv.job_order_no})` : ""} · Balance {money(round2(inv.balance))}
          </option>
        ))}
      </select>

      {candidates.length === 0 && <div className="mt-3 text-sm text-at-slate">No invoices match your search.</div>}

      {target && <InvoicePaymentPanel key={target.id} invoice={target} />}
    </div>
  );
}

// Payment Amount input matches Dispatch's DispatchOrderCard field
// exactly: min={0.01}, max={balance}, step={50}, initial value = balance
// (full outstanding amount pre-filled) — now the round2()'d balance, not
// the raw float, so a historical residue row (e.g.
// 0.00039999999998995918) pre-fills 0.00 and the whole payment control
// disables instead of offering to "record" a fractional-cent phantom
// payment. Receipt number added to match Dispatch's exact field (same
// label/placeholder), for audit-trail consistency across every place a
// payment gets recorded in this app. `useState(balance)` only
// re-initializes on remount (forced by the parent's key={target.id}
// when a DIFFERENT invoice is selected) — recording a second payment on
// the SAME invoice without reselecting it has the same pre-fill
// staleness Dispatch's own cards already have; not a new rough edge
// introduced here, matching the cited precedent exactly rather than
// silently improving on it.
function InvoicePaymentPanel({ invoice }: { invoice: InvoiceRow }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Rounded FIRST, then everything else (pre-fill, max, the "is there
  // anything to pay" gate) derives from this — a historical float-residue
  // row (e.g. balance = 0.00039999999998995918) now reads and behaves as
  // the real GH₵0.00 it is, not as a tiny payable amount.
  const balance = round2(invoice.balance);
  const [payAmt, setPayAmt] = useState(balance);
  const [receiptNo, setReceiptNo] = useState("");

  function handleRecordPayment() {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await recordInvoicePayment(invoice.id, payAmt, receiptNo);
      if (result.error) {
        setError(result.error);
      } else {
        setSuccess(`Payment of ${money(payAmt)} recorded.`);
      }
    });
  }

  return (
    <div className="mt-4 rounded-at-lg border border-at-border bg-at-white p-6 shadow-at-sm">
      <div className="mb-4 text-sm font-bold text-at-navy">
        Invoice: {invoice.customer_name || "—"} — {invoice.date}
      </div>

      <div className="mb-3">
        <div className="text-xs text-at-slate">Outstanding Balance</div>
        <div className="text-xl font-extrabold" style={{ color: balance > 0 ? "#ef4444" : "#10b981" }}>
          {money(balance)}
        </div>
      </div>

      {balance > 0 ? (
        <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div>
            <label className="mb-1 block text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
              Payment Amount
            </label>
            <input
              type="number"
              min={0.01}
              max={balance}
              step={50}
              value={payAmt}
              onChange={(e) => setPayAmt(Number(e.target.value))}
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </div>
          <div>
            <label className="mb-1 block text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
              Receipt number
            </label>
            <input
              type="text"
              value={receiptNo}
              onChange={(e) => setReceiptNo(e.target.value)}
              placeholder="e.g. RCT-00123 — optional, recommended for the audit trail"
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </div>
          <Button disabled={isPending || payAmt <= 0 || payAmt > balance} onClick={handleRecordPayment}>
            Record Payment
          </Button>
        </div>
      ) : (
        // Same principle as Dispatch's Finalize auto-unlocking at
        // balance=0, opposite direction: a rounded-to-zero balance
        // disables the payment action entirely instead of enabling one —
        // nothing meaningful left to pay, so there's no action to offer.
        <div className="inline-block rounded-md border border-green-200 bg-green-50 px-3.5 py-2 text-sm font-semibold text-green-800">
          Fully paid.
        </div>
      )}

      {error && <div className="mt-3 text-sm font-semibold text-red-600">{error}</div>}
      {success && <div className="mt-3 text-sm font-semibold text-emerald-600">{success}</div>}
    </div>
  );
}
