"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

const CURRENCY = "GH₵";

// Ports sanitize_string() from app.py:774-789 exactly: strips only the
// characters that can break out of an HTML tag/attribute (< > " and
// backtick), not a broader allowlist — apostrophes/ampersands in real
// names are preserved.
function sanitizeString(input: string): string {
  return input.replace(/[<>`"]/g, "").trim();
}

function money(n: number): string {
  return `${CURRENCY} ${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}

// Matches datetime.now().date() as a local "YYYY-MM-DD" default for the
// date_input widgets — lazy-initialized via useState where used, never
// called directly during render.
function todayLocalDateStr(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const PRINT_CATEGORY_OPTIONS = ["", "OFFSET", "DIGITAL PRESS", "PACKAGING"];
const MATERIAL_SOURCE_OPTIONS = ["", "Customer Material", "Company Material"];
// Distinct from the resubmit form's "Customer Pick-up" label (app.py:2944)
// — the cart form (app.py:3561) uses "Client Pickup". Two different
// labels for the same concept in the source itself; this route ports
// the cart form's own labels, not resubmit's (resubmit is out of scope).
const DELIVERY_MODE_OPTIONS = ["Company Delivery", "Client Pickup"];
const BINDING_OPTIONS = ["Perfect Binding", "Spiral Binding", "Saddle Stitching", "Comb Binding"];
const LAMINATING_OPTIONS = ["Gloss Laminating", "Matt Laminating", "Soft Touch", "UV-Varnish"];

// Mirrors _new_item's shape from add_cart_item_form (app.py:3600-3624)
// exactly. Deliberately has NO customer_name/telephone_number fields —
// those live only at the shared cart-client level (cartClientName/
// cartClientPhone below), matching the source: individual cart items
// never carry their own customer identity, it's merged in once at
// final submit time from the shared session-state values.
interface PressCartItem {
  department: "PRESS";
  job_description: string;
  total_amount: number;
  deposit_amount: number;
  receipt_no: string | null;
  balance_due_date: string;
  date_of_collection: string;
  qty_to_print: number;
  type_of_print: string;
  material_source: string;
  print_size: string;
  finished_print_size: string;
  paper_type: string;
  gsm: string;
  paper_size: string;
  paper_colour: string;
  impressions_colour: string;
  delivery_mode: string;
  binding_type: string;
  laminating_type: string;
  // Garment-only fields, always null on a PRESS item — "garment fields
  // null for schema safety" per the source's own comment.
  print_type: null;
  yardage: null;
  packaging_mode: null;
  process_info: null;
  material_description: null;
}

interface ItemFormState {
  desc: string;
  totalAmt: number;
  depositAmt: number;
  balanceDue: string;
  collectionDate: string;
  receiptNo: string;
  qty: number;
  typePrint: string;
  materialSource: string;
  printSize: string;
  finishedSize: string;
  paperType: string;
  gsm: string;
  paperSize: string;
  paperColour: string;
  impressionsColour: string;
  deliveryMode: string;
  binding: Set<string>;
  laminating: Set<string>;
}

function blankItemForm(today: string): ItemFormState {
  return {
    desc: "",
    totalAmt: 0,
    depositAmt: 0,
    balanceDue: today,
    collectionDate: today,
    receiptNo: "",
    qty: 0,
    typePrint: "",
    materialSource: "",
    printSize: "",
    finishedSize: "",
    paperType: "",
    gsm: "",
    paperSize: "",
    paperColour: "",
    impressionsColour: "",
    deliveryMode: DELIVERY_MODE_OPTIONS[0],
    binding: new Set(),
    laminating: new Set(),
  };
}

function itemFormFromCartItem(item: PressCartItem): ItemFormState {
  return {
    desc: item.job_description,
    totalAmt: item.total_amount,
    depositAmt: item.deposit_amount,
    balanceDue: item.balance_due_date,
    collectionDate: item.date_of_collection,
    receiptNo: item.receipt_no ?? "",
    qty: item.qty_to_print,
    typePrint: item.type_of_print,
    materialSource: item.material_source,
    printSize: item.print_size,
    finishedSize: item.finished_print_size,
    paperType: item.paper_type,
    gsm: item.gsm,
    paperSize: item.paper_size,
    paperColour: item.paper_colour,
    impressionsColour: item.impressions_colour,
    deliveryMode: item.delivery_mode,
    binding: new Set(
      item.binding_type && item.binding_type !== "None" ? item.binding_type.split(", ") : []
    ),
    laminating: new Set(
      item.laminating_type && item.laminating_type !== "None" ? item.laminating_type.split(", ") : []
    ),
  };
}

export function RaiseOrderClient({ userEmail }: { userEmail: string }) {
  // Lazy initializer — same purity reasoning as every other Date-based
  // default in this codebase (GanttChart's `now`, Shop Floor's
  // todayLocalDateStr, Production Layout Builder's todayLocalDateStr).
  const [today] = useState(() => todayLocalDateStr());

  const [cartClientName, setCartClientName] = useState("");
  const [cartClientPhone, setCartClientPhone] = useState("");
  const [cartItems, setCartItems] = useState<PressCartItem[]>([]);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);

  const [form, setForm] = useState<ItemFormState>(() => blankItemForm(today));
  const [missingFields, setMissingFields] = useState<string[]>([]);

  function toggleBinding(opt: string) {
    setForm((f) => {
      const next = new Set(f.binding);
      if (next.has(opt)) next.delete(opt);
      else next.add(opt);
      return { ...f, binding: next };
    });
  }
  function toggleLaminating(opt: string) {
    setForm((f) => {
      const next = new Set(f.laminating);
      if (next.has(opt)) next.delete(opt);
      else next.add(opt);
      return { ...f, laminating: next };
    });
  }

  function startEditing(idx: number) {
    setEditingIdx(idx);
    setForm(itemFormFromCartItem(cartItems[idx]));
  }

  function cancelEditing() {
    setEditingIdx(null);
  }

  function removeItem(idx: number) {
    setCartItems((items) => items.filter((_, i) => i !== idx));
    if (editingIdx === idx) setEditingIdx(null);
  }

  function clearCart() {
    setCartItems([]);
    setCartClientName("");
    setCartClientPhone("");
    setEditingIdx(null);
  }

  function handleAddOrUpdate() {
    const missing: string[] = [];
    if (!cartClientName.trim()) missing.push("Customer Name");
    if (!cartClientPhone.trim()) missing.push("Telephone Number");
    if (!form.desc.trim()) missing.push("Item Description");
    if (form.totalAmt <= 0) missing.push("Total Item Amount");
    if (form.qty <= 0) missing.push("Quantity");
    if (!form.typePrint) missing.push("Print Category");
    if (form.depositAmt > 0 && !form.receiptNo.trim()) {
      missing.push("Receipt Number (required since a deposit was entered)");
    }

    setMissingFields(missing);
    if (missing.length > 0) return;

    const newItem: PressCartItem = {
      department: "PRESS",
      job_description: sanitizeString(form.desc),
      total_amount: form.totalAmt,
      deposit_amount: form.depositAmt,
      receipt_no: form.depositAmt > 0 ? sanitizeString(form.receiptNo) : null,
      balance_due_date: form.balanceDue,
      date_of_collection: form.collectionDate,
      qty_to_print: Math.trunc(form.qty),
      type_of_print: form.typePrint,
      material_source: form.materialSource,
      print_size: sanitizeString(form.printSize),
      finished_print_size: sanitizeString(form.finishedSize),
      paper_type: sanitizeString(form.paperType),
      gsm: sanitizeString(form.gsm),
      paper_size: sanitizeString(form.paperSize),
      paper_colour: sanitizeString(form.paperColour),
      // NOT sanitized — matches the source exactly (every other text
      // field here goes through sanitize_string(), impressions_colour
      // is the one exception).
      impressions_colour: form.impressionsColour,
      delivery_mode: form.deliveryMode,
      binding_type: form.binding.size > 0 ? Array.from(form.binding).join(", ") : "None",
      laminating_type: form.laminating.size > 0 ? Array.from(form.laminating).join(", ") : "None",
      print_type: null,
      yardage: null,
      packaging_mode: null,
      process_info: null,
      material_description: null,
    };

    setCartClientName(cartClientName.trim());
    setCartClientPhone(cartClientPhone.trim());

    if (editingIdx !== null && editingIdx >= 0 && editingIdx < cartItems.length) {
      setCartItems((items) => items.map((it, i) => (i === editingIdx ? newItem : it)));
      setEditingIdx(null);
    } else {
      setCartItems((items) => [...items, newItem]);
    }

    setForm(blankItemForm(today));
    setMissingFields([]);
  }

  const cartTotal = cartItems.reduce((sum, it) => sum + it.total_amount, 0);
  const cartDeposit = cartItems.reduce((sum, it) => sum + it.deposit_amount, 0);
  const cartHasBalance = cartItems.some((it) => it.total_amount !== it.deposit_amount);
  const isEditing = editingIdx !== null;

  return (
    <div>
      <div className="mb-4 text-lg font-bold text-at-navy-soft">PRESS Job Order Entry</div>

      {cartItems.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2 rounded-at-lg border border-green-300 bg-gradient-to-br from-green-50 to-green-100 px-5 py-3.5">
          <div className="text-sm font-bold text-green-800">
            🛒 {cartItems.length} item(s) in cart for {cartClientName || "—"}
          </div>
          <div className="text-xs text-green-700">
            Add more items below, or scroll down to submit the batch
          </div>
        </div>
      )}

      {isEditing && (
        <div className="mb-3 flex items-center justify-between rounded-at border border-sky-200 bg-sky-50 px-4 py-2.5">
          <div className="text-sm text-sky-900">
            Editing Item {(editingIdx as number) + 1} — correct the fields below and click Update.
          </div>
          <Button variant="secondary" size="sm" onClick={cancelEditing}>
            Cancel Edit
          </Button>
        </div>
      )}

      <div className="rounded-at-lg border border-at-border bg-at-white p-6 shadow-at-sm">
        <SectionHeader>Client Identity — Shared Across All Items in This Batch</SectionHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Customer Name ★">
            <input
              type="text"
              value={cartClientName}
              onChange={(e) => setCartClientName(e.target.value)}
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </FormField>
          <FormField label="Telephone Number ★">
            <input
              type="text"
              value={cartClientPhone}
              onChange={(e) => setCartClientPhone(e.target.value)}
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </FormField>
        </div>

        <SectionHeader>Product Item Specifications</SectionHeader>
        <div className="mb-3">
          <FormField label="Item Description ★">
            <textarea
              value={form.desc}
              onChange={(e) => setForm((f) => ({ ...f, desc: e.target.value }))}
              placeholder="e.g. Skillet Box (250gsm Gloss), A5 Brochure, Business Cards..."
              rows={2}
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </FormField>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <FormField label={`Total Item Amount (${CURRENCY}) ★`}>
            <input
              type="number"
              min={0}
              step={100}
              value={form.totalAmt}
              onChange={(e) => setForm((f) => ({ ...f, totalAmt: Number(e.target.value) }))}
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </FormField>
          <FormField label={`Deposit Paid (${CURRENCY})`}>
            <input
              type="number"
              min={0}
              step={100}
              value={form.depositAmt}
              onChange={(e) => setForm((f) => ({ ...f, depositAmt: Number(e.target.value) }))}
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </FormField>
          <FormField label="Balance Deadline ★">
            <input
              type="date"
              value={form.balanceDue}
              onChange={(e) => setForm((f) => ({ ...f, balanceDue: e.target.value }))}
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </FormField>
          <FormField label="Collection Date ★">
            <input
              type="date"
              value={form.collectionDate}
              onChange={(e) => setForm((f) => ({ ...f, collectionDate: e.target.value }))}
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </FormField>
        </div>
        <div className="mt-3 max-w-sm">
          <FormField label="Receipt Number (required if a deposit is entered)">
            <input
              type="text"
              value={form.receiptNo}
              onChange={(e) => setForm((f) => ({ ...f, receiptNo: e.target.value }))}
              placeholder="e.g. RCT-00123"
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </FormField>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4">
          <FormField label="Quantity ★">
            <input
              type="number"
              min={0}
              step={500}
              value={form.qty}
              onChange={(e) => setForm((f) => ({ ...f, qty: Number(e.target.value) }))}
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </FormField>
          <FormField label="Print Category ★">
            <select
              value={form.typePrint}
              onChange={(e) => setForm((f) => ({ ...f, typePrint: e.target.value }))}
              className="w-full rounded-at border border-at-border bg-at-white px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            >
              {PRINT_CATEGORY_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o || "— Select —"}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Material Source">
            <select
              value={form.materialSource}
              onChange={(e) => setForm((f) => ({ ...f, materialSource: e.target.value }))}
              className="w-full rounded-at border border-at-border bg-at-white px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            >
              {MATERIAL_SOURCE_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o || "— Select —"}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Delivery Mode">
            <select
              value={form.deliveryMode}
              onChange={(e) => setForm((f) => ({ ...f, deliveryMode: e.target.value }))}
              className="w-full rounded-at border border-at-border bg-at-white px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            >
              {DELIVERY_MODE_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </FormField>
        </div>

        <SectionHeader>Material &amp; Engineering Specifics</SectionHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <FormField label="Print Size">
            <input
              type="text"
              value={form.printSize}
              onChange={(e) => setForm((f) => ({ ...f, printSize: e.target.value }))}
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </FormField>
          <FormField label="Finished Size">
            <input
              type="text"
              value={form.finishedSize}
              onChange={(e) => setForm((f) => ({ ...f, finishedSize: e.target.value }))}
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </FormField>
          <FormField label="Paper Material">
            <input
              type="text"
              value={form.paperType}
              onChange={(e) => setForm((f) => ({ ...f, paperType: e.target.value }))}
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </FormField>
          <FormField label="GSM">
            <input
              type="text"
              value={form.gsm}
              onChange={(e) => setForm((f) => ({ ...f, gsm: e.target.value }))}
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </FormField>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <FormField label="Paper Size">
            <input
              type="text"
              value={form.paperSize}
              onChange={(e) => setForm((f) => ({ ...f, paperSize: e.target.value }))}
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </FormField>
          <FormField label="Colour / Ink Specs">
            <input
              type="text"
              value={form.paperColour}
              onChange={(e) => setForm((f) => ({ ...f, paperColour: e.target.value }))}
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </FormField>
          <FormField label="Impressions">
            <input
              type="text"
              value={form.impressionsColour}
              onChange={(e) => setForm((f) => ({ ...f, impressionsColour: e.target.value }))}
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </FormField>
        </div>

        <div className="mt-4">
          <div className="mb-1.5 text-sm font-semibold text-at-navy">Binding Selection</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {BINDING_OPTIONS.map((o) => (
              <label key={o} className="flex items-center gap-2 text-sm text-at-slate">
                <input type="checkbox" checked={form.binding.has(o)} onChange={() => toggleBinding(o)} />
                {o}
              </label>
            ))}
          </div>
        </div>
        <div className="mt-3">
          <div className="mb-1.5 text-sm font-semibold text-at-navy">Laminating Selection</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {LAMINATING_OPTIONS.map((o) => (
              <label key={o} className="flex items-center gap-2 text-sm text-at-slate">
                <input type="checkbox" checked={form.laminating.has(o)} onChange={() => toggleLaminating(o)} />
                {o}
              </label>
            ))}
          </div>
        </div>

        <div className="mt-4 rounded-at border border-at-border bg-at-bg px-4 py-2.5 text-xs text-at-slate">
          Handled By: {userEmail} | Date: {today}
        </div>

        {missingFields.length > 0 && (
          <div className="mt-3 text-sm font-semibold text-red-600">
            Cannot add item — missing required fields: {missingFields.join(", ")}
          </div>
        )}

        <div className="mt-4">
          <Button onClick={handleAddOrUpdate}>{isEditing ? "Update Item in Cart" : "Add Item to Cart"}</Button>
        </div>
      </div>

      {cartItems.length > 0 && (
        <div className="mt-6">
          <div className="mb-3 text-base font-bold text-at-navy">
            🛒 Active Cart — {cartItems.length} Item(s) for {cartClientName}
          </div>
          <div className="flex flex-col gap-2">
            {cartItems.map((item, idx) => {
              const preview =
                item.job_description.length > 80
                  ? `${item.job_description.slice(0, 80)}…`
                  : item.job_description;
              return (
                <div key={idx} className="flex items-center gap-2">
                  <div className="flex-1 rounded-at border border-at-border border-l-4 border-l-at-accent bg-at-bg px-4 py-3">
                    <div className="text-sm font-bold text-at-navy">
                      Item {idx + 1}: {preview}
                    </div>
                    <div className="mt-1 text-xs text-at-slate">
                      Qty: <strong>{item.qty_to_print.toLocaleString()}</strong> &nbsp;·&nbsp; Category:{" "}
                      <strong>{item.type_of_print}</strong> &nbsp;·&nbsp; Amount:{" "}
                      <strong>{money(item.total_amount)}</strong> &nbsp;·&nbsp; Deposit:{" "}
                      <strong>{money(item.deposit_amount)}</strong> &nbsp;·&nbsp; Collection:{" "}
                      <strong>{item.date_of_collection}</strong>
                    </div>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => startEditing(idx)}>
                    ✏️ Edit
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => removeItem(idx)}>
                    ✕ Remove
                  </Button>
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-8 rounded-at-lg bg-gradient-to-br from-at-navy to-at-navy-soft p-5 text-at-white">
            <SummaryTile label="Client" value={cartClientName || "—"} />
            <SummaryTile label="Items" value={String(cartItems.length)} />
            <SummaryTile label="Combined Contract Value" value={money(cartTotal)} valueColor="#34d399" />
            <SummaryTile label="Total Deposit Collected" value={money(cartDeposit)} valueColor="#7dd3fc" />
            {cartHasBalance && (
              <div className="rounded-full border border-amber-300 bg-amber-100/10 px-3 py-1 text-xs font-bold text-amber-300">
                ⚠️ Outstanding balance in this batch
              </div>
            )}
          </div>

          <div className="mt-4 flex gap-3">
            <Button variant="ghost" fullWidth>
              SUBMIT {cartItems.length} ITEM(S) FOR MANAGEMENT APPROVAL — coming in Phase 3
            </Button>
            <Button variant="secondary" onClick={clearCart}>
              🗑 Clear Cart
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return <div className="mb-3 mt-6 text-sm font-bold uppercase tracking-wide text-at-navy first:mt-0">{children}</div>;
}

function SummaryTile({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div>
      <div className="mb-0.5 text-[0.62rem] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-sm font-bold" style={valueColor ? { color: valueColor } : undefined}>
        {value}
      </div>
    </div>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">{label}</label>
      {children}
    </div>
  );
}
