"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { PdfPreviewButton } from "@/components/ui/pdf-preview-button";
import { submitBatch, resubmitOrder as resubmitOrderAction } from "./actions";

const CURRENCY = "GH₵";

// Ports SALES_REP_EMAILS' keys (app.py:126-136) — the dropdown only
// ever shows/stores the NAME (a dict key), never the email; the email
// lookup is a separate concern this route doesn't need.
const SALES_REP_NAMES = [
  "Mabel Ampofo",
  "Daphne Sarpong",
  "Reginald Aidam",
  "Charles Adoo",
  "Isaac Kum",
  "Bertha Tackie",
  "Christian Mante",
  "Jacqueline Afful",
  "Mohammed Seidu Bunyamin",
  "Elizabeth Addo Obeng",
];
const SALES_REP_SENTINEL = "— None / Walk-in —";

// Matches f"PG-{datetime.now().strftime('%Y%m%d-%H%M%S')}-{random.randint(1000,9999)}"
// (Press) / the "GPG-" equivalent (Garment) exactly. Generated
// client-side, per this task's explicit instruction — unlike
// Production Layout Builder's anchor_start (a scheduling-critical
// value where server-authoritative "now" mattered), this is just an
// opaque batch identifier, and the SAME client-generated value is
// threaded through both the file-upload storage path and the
// parent_group_id column so the two can never drift apart.
function generateParentGroupId(prefix: "PG" | "GPG"): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const datePart = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const timePart = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${datePart}-${timePart}-${rand}`;
}

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

function SectionHeader({ children }: { children: React.ReactNode }) {
  return <div className="mb-3 mt-6 text-sm font-bold uppercase tracking-wide text-at-navy first:mt-0">{children}</div>;
}

function SummaryTile({ label, value, labelColor, valueColor }: { label: string; value: string; labelColor?: string; valueColor?: string }) {
  return (
    <div>
      <div className="mb-0.5 text-[0.62rem] uppercase tracking-wide" style={{ color: labelColor ?? "#94a3b8" }}>
        {label}
      </div>
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

// Shared by both carts — identical fields/behavior in the source for
// Press and Garment alike (app.py:3695-3718 / app.py:4100-4123), unlike
// the item forms themselves which genuinely differ per department.
interface AttachmentsTermsState {
  lpoFile: File | null;
  sampleFile: File | null;
  sampleAttached: "No" | "Yes";
  sampleWith: string;
  is30Day: boolean;
  salesRep: string; // "" represents the "— None / Walk-in —" sentinel
  termsNotes: string;
}

function blankAttachmentsTerms(): AttachmentsTermsState {
  return {
    lpoFile: null,
    sampleFile: null,
    sampleAttached: "No",
    sampleWith: "",
    is30Day: false,
    salesRep: "",
    termsNotes: "",
  };
}

function AttachmentsAndTermsSection({
  state,
  setState,
  cartHasBalance,
}: {
  state: AttachmentsTermsState;
  setState: React.Dispatch<React.SetStateAction<AttachmentsTermsState>>;
  cartHasBalance: boolean;
}) {
  return (
    <div className="mt-6">
      <div className="mb-3 text-base font-bold text-at-navy">
        📎 Attachments &amp; Terms — Applies to This Whole Batch
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField label="Upload LPO (optional) — goes to MD/FM">
          <input
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            onChange={(e) => setState((s) => ({ ...s, lpoFile: e.target.files?.[0] ?? null }))}
            className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
          />
        </FormField>
        <FormField label="Upload Sample Photo (optional) — goes to the department">
          <input
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            onChange={(e) => setState((s) => ({ ...s, sampleFile: e.target.files?.[0] ?? null }))}
            className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
          />
        </FormField>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField label="Sample Attached?">
          <select
            value={state.sampleAttached}
            onChange={(e) => setState((s) => ({ ...s, sampleAttached: e.target.value as "No" | "Yes" }))}
            className="w-full rounded-at border border-at-border bg-at-white px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
          >
            <option value="No">No</option>
            <option value="Yes">Yes</option>
          </select>
        </FormField>
        <FormField label="Sample With (required if Yes)">
          <input
            type="text"
            value={state.sampleWith}
            onChange={(e) => setState((s) => ({ ...s, sampleWith: e.target.value }))}
            placeholder="e.g. Front Desk, With Client, Production"
            className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
          />
        </FormField>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-sm text-at-slate">
          <input
            type="checkbox"
            checked={state.is30Day}
            onChange={(e) => setState((s) => ({ ...s, is30Day: e.target.checked }))}
          />
          30-Day Credit Terms job
        </label>
        <FormField label="Sales / Marketing Rep (who brought this job)">
          <select
            value={state.salesRep}
            onChange={(e) => setState((s) => ({ ...s, salesRep: e.target.value }))}
            className="w-full rounded-at border border-at-border bg-at-white px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
          >
            <option value="">{SALES_REP_SENTINEL}</option>
            {SALES_REP_NAMES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </FormField>
      </div>
      {cartHasBalance && (
        <div className="mt-3">
          <FormField label="Payment Terms Notes — this batch isn't fully paid; explain the arrangement for MD/FM">
            <textarea
              value={state.termsNotes}
              onChange={(e) => setState((s) => ({ ...s, termsNotes: e.target.value }))}
              placeholder="e.g. Client to pay balance on collection; LPO attached; verbal agreement with MD on..."
              rows={2}
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </FormField>
        </div>
      )}
    </div>
  );
}

// Phase 2 of the clients subsystem: identity/contact only (see
// clients table, Phase 1) — no ownership fields here, sales_rep stays
// a per-order field on job_orders, untouched by this picker.
export interface ClientOption {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
}

const NEW_CLIENT_VALUE = "__new_client__";

// Same search+select pattern as Material Issuance's order picker
// (material-issuances-client.tsx's IssuanceForm: a free-text filter
// input above a <select> of candidates) plus an explicit "+ New
// Client" sentinel option, always last in the list. Shared by both
// PressCart and GarmentCart — identical Client Identity block in both,
// same in-file-sharing precedent as FormField/SectionHeader/
// AttachmentsAndTermsSection above.
//
// Selecting an existing client auto-fills name/phone into the
// (still-editable) fields below — "auto-fill from source, never
// locked," same convention as Material Issuance's unit cost / customer
// name auto-fill. Selecting "+ New Client" reveals the same name/phone
// fields empty, plus an email field only relevant to the new-client
// path (job_orders itself has no email column — email only ever
// reaches the clients table, never a job_orders row).
//
// The duplicate-name warning below is a client-side convenience only —
// the real gate is submitBatch's own case-insensitive check
// server-side (a Server Action is a real network boundary, and this
// component's `clients` list is a snapshot fetched at page load, not
// guaranteed current by the time of submit).
function ClientIdentitySection({
  clients,
  clientSearch,
  setClientSearch,
  selectedClientId,
  setSelectedClientId,
  clientName,
  setClientName,
  clientPhone,
  setClientPhone,
  clientEmail,
  setClientEmail,
}: {
  clients: ClientOption[];
  clientSearch: string;
  setClientSearch: (v: string) => void;
  selectedClientId: number | "new" | "";
  setSelectedClientId: (v: number | "new" | "") => void;
  clientName: string;
  setClientName: (v: string) => void;
  clientPhone: string;
  setClientPhone: (v: string) => void;
  clientEmail: string;
  setClientEmail: (v: string) => void;
}) {
  const q = clientSearch.trim().toLowerCase();
  const candidates = q ? clients.filter((c) => c.name.toLowerCase().includes(q)) : clients;

  function handleSelect(raw: string) {
    if (raw === "") {
      setSelectedClientId("");
      setClientName("");
      setClientPhone("");
      setClientEmail("");
      return;
    }
    if (raw === NEW_CLIENT_VALUE) {
      setSelectedClientId("new");
      setClientName("");
      setClientPhone("");
      setClientEmail("");
      return;
    }
    const id = Number(raw);
    setSelectedClientId(id);
    const client = clients.find((c) => c.id === id);
    setClientName(client?.name ?? "");
    setClientPhone(client?.phone ?? "");
    setClientEmail("");
  }

  // Case-insensitive — confirmed decision: "ABC Ltd" and "abc ltd" are
  // treated as the same client for this warning, since clients.name's
  // real UNIQUE constraint is case-SENSITIVE (an exact-case duplicate
  // literally cannot be inserted regardless) and a case-only variant is
  // almost always the same real-world client, not a new one.
  const duplicate =
    selectedClientId === "new" && clientName.trim()
      ? clients.find((c) => c.name.trim().toLowerCase() === clientName.trim().toLowerCase())
      : undefined;

  return (
    <div>
      <FormField label="Find Client">
        <input
          type="text"
          value={clientSearch}
          onChange={(e) => setClientSearch(e.target.value)}
          placeholder="Search by client name..."
          className="mb-2 w-full rounded-at border border-at-border bg-at-white px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
        />
        <select
          value={selectedClientId === "new" ? NEW_CLIENT_VALUE : selectedClientId}
          onChange={(e) => handleSelect(e.target.value)}
          className="w-full rounded-at border border-at-border bg-at-white px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
        >
          <option value="">— Select a client —</option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.phone ? ` — ${c.phone}` : ""}
            </option>
          ))}
          <option value={NEW_CLIENT_VALUE}>+ New Client…</option>
        </select>
        {candidates.length === 0 && clientSearch.trim() && (
          <div className="mt-2 text-sm text-at-slate">
            No matching client — choose &ldquo;+ New Client&rdquo; above to add one.
          </div>
        )}
      </FormField>

      {selectedClientId !== "" && (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Customer Name ★">
            <input
              type="text"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </FormField>
          <FormField label="Telephone Number ★">
            <input
              type="text"
              value={clientPhone}
              onChange={(e) => setClientPhone(e.target.value)}
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </FormField>
          {selectedClientId === "new" && (
            <FormField label="Email (optional)">
              <input
                type="email"
                value={clientEmail}
                onChange={(e) => setClientEmail(e.target.value)}
                className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
              />
            </FormField>
          )}
        </div>
      )}

      {duplicate && (
        <div className="mt-3 rounded-at border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <div className="font-bold">A client named &ldquo;{duplicate.name}&rdquo; already exists.</div>
          <div className="mt-1 text-xs text-amber-800">
            Phone: {duplicate.phone || "—"} &nbsp;·&nbsp; Email: {duplicate.email || "—"}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => handleSelect(String(duplicate.id))}>
              Use this existing client instead
            </Button>
            <span className="text-xs text-amber-800">
              or adjust the name above if this is genuinely a different client.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// Full original job_orders row for the order being resubmitted — every
// _rd()/_rdf()/_rdi()/_rdd()/_rdl() call in both resubmit forms
// (app.py) reads straight off resubmit_data, which is the ENTIRE
// rejected row, not a purpose-built subset. Fetched fresh server-side
// by page.tsx (select("*") for exactly one id, re-verified Rejected +
// owned by the requesting user) rather than trusted from the client.
export interface ResubmitOrderData {
  id: number;
  job_order_no: string | null;
  customer_name: string | null;
  telephone_number: string | null;
  job_description: string | null;
  total_amount: number | null;
  deposit_amount: number | null;
  receipt_no: string | null;
  balance_due_date: string | null;
  date_of_collection: string | null;
  sample_attached: string | null;
  sample_with: string | null;
  payment_terms: string | null;
  qty_to_print: number | null;
  type_of_print: string | null;
  print_type: string | null;
  material_source: string | null;
  delivery_mode: string | null;
  print_size: string | null;
  finished_print_size: string | null;
  yardage: string | null;
  paper_type: string | null;
  gsm: string | null;
  paper_size: string | null;
  paper_colour: string | null;
  impressions_colour: string | null;
  binding_type: string | null;
  laminating_type: string | null;
  material_description: string | null;
  additional_comments: string | null;
  packaging_mode: string | null;
  qty_to_pack: number | null;
  packaging_specs: string | null;
  delivery_location: string | null;
  delivery_contact: string | null;
  process_info: string | null;
  parent_group_id: string | null;
  department: string | null;
}

// ═══════════════════════════════════════════════════════════════════
// Top-level: Department toggle (app.py:3454-3467) — a single selectbox,
// not a route/tab split. selected_department gates which cart renders,
// exactly matching the source's `if selected_department == "PRESS": ...
// else: [GARMENT]` structure. When resubmitOrder is present (from My
// Order Tracker's "Modify & Resubmit" link), this mirrors the source's
// OUTER `if resubmit_data: ... else: [NORMAL MODE]` branch instead —
// resubmit mode bypasses the Department toggle and both carts entirely,
// routing on the rejected order's OWN `department` field
// (`resubmit_data.get("department", "PRESS")` in the source).
// ═══════════════════════════════════════════════════════════════════
export function RaiseOrderClient({
  userEmail,
  resubmitOrder,
  clients,
}: {
  userEmail: string;
  resubmitOrder: ResubmitOrderData | null;
  clients: ClientOption[];
}) {
  const [department, setDepartment] = useState<"PRESS" | "GARMENT">("PRESS");

  if (resubmitOrder) {
    const dept = resubmitOrder.department === "GARMENT" ? "GARMENT" : "PRESS";
    return (
      <div>
        <div className="mb-4 rounded-at-lg border border-red-300 bg-gradient-to-br from-red-50 to-rose-100 p-5">
          <div className="mb-1 text-xs font-bold uppercase tracking-wide text-red-800">
            Resubmission Mode Active
          </div>
          <div className="text-sm text-red-900">
            You are correcting and resubmitting{" "}
            <strong>{resubmitOrder.job_order_no ?? "this order"}</strong> for{" "}
            <strong>{resubmitOrder.customer_name ?? ""}</strong>. All fields are pre-loaded. Make
            your corrections then click RESUBMIT.
          </div>
        </div>
        {dept === "GARMENT" ? (
          <GarmentResubmitForm order={resubmitOrder} userEmail={userEmail} />
        ) : (
          <PressResubmitForm order={resubmitOrder} userEmail={userEmail} />
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 max-w-md">
        <FormField label="Department">
          <select
            value={department}
            onChange={(e) => setDepartment(e.target.value as "PRESS" | "GARMENT")}
            className="w-full rounded-at border border-at-border bg-at-white px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
          >
            <option value="PRESS">PRESS</option>
            <option value="GARMENT">GARMENT</option>
          </select>
        </FormField>
        <div className="mt-1 text-xs text-at-slate-light">
          Select PRESS for offset/digital/packaging orders, GARMENT for apparel &amp; large format.
        </div>
      </div>

      <div className="mb-4 text-lg font-bold text-at-navy-soft">{department} Job Order Entry</div>

      {department === "PRESS" ? (
        <PressCart userEmail={userEmail} clients={clients} />
      ) : (
        <GarmentCart userEmail={userEmail} clients={clients} />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// PRESS CART (Phase 1) — app.py:3472-3800
// ═══════════════════════════════════════════════════════════════════

const PRINT_CATEGORY_OPTIONS = ["", "OFFSET", "DIGITAL PRESS", "PACKAGING"];
const MATERIAL_SOURCE_OPTIONS = ["", "Customer Material", "Company Material"];
// "Client Pickup" — consistently PRESS's own label across BOTH forms
// that collect it (app.py:3561 New-cart, app.py:3243 Resubmit); it's
// GARMENT that differs (see GARMENT_DELIVERY_MODE_OPTIONS's own note),
// not New-cart vs. Resubmit within one department. An earlier version
// of this comment claimed the opposite before the resubmit forms had
// actually been read — corrected once they were.
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

function PressCart({ userEmail, clients }: { userEmail: string; clients: ClientOption[] }) {
  // Lazy initializer — same purity reasoning as every other Date-based
  // default in this codebase (GanttChart's `now`, Shop Floor's
  // todayLocalDateStr, Production Layout Builder's todayLocalDateStr).
  const [today] = useState(() => todayLocalDateStr());

  const [clientSearch, setClientSearch] = useState("");
  const [selectedClientId, setSelectedClientId] = useState<number | "new" | "">("");
  const [cartClientName, setCartClientName] = useState("");
  const [cartClientPhone, setCartClientPhone] = useState("");
  const [cartClientEmail, setCartClientEmail] = useState("");
  const [cartItems, setCartItems] = useState<PressCartItem[]>([]);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);

  const [form, setForm] = useState<ItemFormState>(() => blankItemForm(today));
  const [missingFields, setMissingFields] = useState<string[]>([]);

  const [attachments, setAttachments] = useState<AttachmentsTermsState>(blankAttachmentsTerms);
  const [isSubmitting, startSubmitTransition] = useTransition();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitWarnings, setSubmitWarnings] = useState<string[]>([]);
  const [confirmedBatch, setConfirmedBatch] = useState<Record<string, unknown>[] | null>(null);

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
    setClientSearch("");
    setSelectedClientId("");
    setCartClientName("");
    setCartClientPhone("");
    setCartClientEmail("");
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

  // Mirrors the SUBMIT button's handler (app.py:3722-3793) exactly,
  // including its own pre-checks — re-validated server-side too, since
  // the Server Action is a real network boundary.
  function handleSubmitBatch() {
    setSubmitError(null);
    setSubmitWarnings([]);
    if (!cartClientName.trim() || !cartClientPhone.trim()) {
      setSubmitError("Client name and telephone must be set before submitting the batch.");
      return;
    }
    if (attachments.sampleAttached === "Yes" && !attachments.sampleWith.trim()) {
      setSubmitError("Sample is marked attached — enter who has it before submitting.");
      return;
    }
    // Client-side convenience copy of the same case-insensitive check
    // submitBatch runs server-side — this just gives an immediate error
    // instead of a round-trip when the inline warning under the picker
    // somehow got missed/dismissed. The server check is the real gate.
    if (selectedClientId === "new") {
      const dup = clients.find((c) => c.name.trim().toLowerCase() === cartClientName.trim().toLowerCase());
      if (dup) {
        setSubmitError(
          `A client named "${dup.name}" already exists (phone: ${dup.phone || "—"}). Select them from the client list instead, or adjust the name if this is a different client.`
        );
        return;
      }
    }

    const pgid = generateParentGroupId("PG");
    const fd = new FormData();
    fd.set("pgid", pgid);
    fd.set("clientName", cartClientName);
    fd.set("clientPhone", cartClientPhone);
    fd.set("isNewClient", String(selectedClientId === "new"));
    fd.set("clientEmail", cartClientEmail);
    fd.set("items", JSON.stringify(cartItems));
    fd.set("sampleAttached", attachments.sampleAttached);
    fd.set("sampleWith", attachments.sampleWith);
    fd.set("is30Day", String(attachments.is30Day));
    fd.set("termsNotes", attachments.termsNotes);
    fd.set("salesRep", attachments.salesRep);
    if (attachments.lpoFile) fd.set("lpoFile", attachments.lpoFile);
    if (attachments.sampleFile) fd.set("sampleFile", attachments.sampleFile);

    startSubmitTransition(async () => {
      const result = await submitBatch(fd);
      if (result.error) {
        setSubmitError(result.error);
        if (result.warnings) setSubmitWarnings(result.warnings);
        return;
      }
      setConfirmedBatch(result.submitted ?? []);
      if (result.warnings) setSubmitWarnings(result.warnings);
      setCartItems([]);
      setClientSearch("");
      setSelectedClientId("");
      setCartClientName("");
      setCartClientPhone("");
      setCartClientEmail("");
      setEditingIdx(null);
      setAttachments(blankAttachmentsTerms());
    });
  }

  return (
    <div>
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
        <ClientIdentitySection
          clients={clients}
          clientSearch={clientSearch}
          setClientSearch={setClientSearch}
          selectedClientId={selectedClientId}
          setSelectedClientId={setSelectedClientId}
          clientName={cartClientName}
          setClientName={setCartClientName}
          clientPhone={cartClientPhone}
          setClientPhone={setCartClientPhone}
          clientEmail={cartClientEmail}
          setClientEmail={setCartClientEmail}
        />

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

          <AttachmentsAndTermsSection state={attachments} setState={setAttachments} cartHasBalance={cartHasBalance} />

          {submitError && <div className="mt-3 text-sm font-semibold text-red-600">{submitError}</div>}
          {submitWarnings.length > 0 &&
            submitWarnings.map((w, i) => (
              <div key={i} className="mt-3 text-sm font-semibold text-amber-600">
                {w}
              </div>
            ))}

          <div className="mt-4 flex gap-3">
            <Button disabled={isSubmitting} onClick={handleSubmitBatch}>
              {isSubmitting ? "SUBMITTING…" : `SUBMIT ${cartItems.length} ITEM(S) FOR MANAGEMENT APPROVAL`}
            </Button>
            <Button variant="secondary" onClick={clearCart} disabled={isSubmitting}>
              🗑 Clear Cart
            </Button>
          </div>
        </div>
      )}

      {confirmedBatch && confirmedBatch.length > 0 && (
        <div className="mt-6">
          <div className="rounded-at-lg border border-green-300 bg-gradient-to-br from-green-50 to-green-100 p-5">
            <div className="mb-1 text-xs font-bold uppercase tracking-wide text-green-800">
              Batch Submission Confirmed
            </div>
            <div className="text-lg font-extrabold text-at-navy">
              {confirmedBatch.length} item(s) deposited in management authorization ledger
            </div>
            <div className="mt-1 text-sm text-green-700">
              Batch Ref: <strong>{String(confirmedBatch[0].parent_group_id ?? "—")}</strong> &nbsp;·&nbsp; Client:{" "}
              <strong>{String(confirmedBatch[0].customer_name ?? "—")}</strong>
            </div>
          </div>
          <div className="mt-3 flex flex-col gap-2">
            {confirmedBatch.map((ticket, i) => {
              const desc = String(ticket.job_description ?? "");
              const preview = desc.length > 60 ? `${desc.slice(0, 60)}…` : desc;
              return (
                <div
                  key={i}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-at border border-at-border border-l-4 border-l-green-500 bg-at-white px-4 py-3"
                >
                  <div>
                    <div className="text-sm font-bold text-at-navy">
                      Item {i + 1}: {preview}
                    </div>
                    <div className="mt-1 text-xs text-at-slate">
                      Ref: <strong className="text-at-accent">{String(ticket.job_order_no ?? "PENDING")}</strong>{" "}
                      &nbsp;·&nbsp; {Number(ticket.qty_to_print ?? 0).toLocaleString()} units &nbsp;·&nbsp;{" "}
                      {String(ticket.type_of_print ?? "")} &nbsp;·&nbsp; {money(Number(ticket.total_amount ?? 0))}
                    </div>
                  </div>
                  <PdfPreviewButton orderId={Number(ticket.id)} label="📄 Export PDF" />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// GARMENT CART (Phase 2) — app.py:3846-4210
// ═══════════════════════════════════════════════════════════════════

// Same list as Archive's category dropdown / Authorization Center's
// garment print type (app.py:3927).
const GARMENT_PRINT_TYPE_OPTIONS = ["", "DTF", "Flexi Screen Print", "UV-DTF", "SAV", "Embroidery"];
// Reversed order vs the Press cart's MATERIAL_SOURCE_OPTIONS (Customer
// first there, Company first here) — a real inconsistency between the
// two forms in the source itself (app.py:3556 vs app.py:3920), kept
// exactly as-is rather than unified.
const GARMENT_MATERIAL_SOURCE_OPTIONS = ["", "Company Material", "Customer Material"];
// "Customer Pick-up" — consistently GARMENT's own label across BOTH
// forms that collect it (app.py:3932 New-cart, app.py:2944 Resubmit),
// distinct from PRESS's "Client Pickup" (see DELIVERY_MODE_OPTIONS's
// own note) — a genuine cross-department difference, not a New-cart
// vs. Resubmit one.
const GARMENT_DELIVERY_MODE_OPTIONS = ["Company Delivery", "Customer Pick-up"];
// Print Size is a FIXED DROPDOWN in the Garment form (app.py:3940),
// unlike Press's free-text "Print Size" input — a real, deliberate
// difference between the two forms' field types, not just their
// options.
const GARMENT_PRINT_SIZE_OPTIONS = ["", "A1", "A2", "A3", "A4", "A5", "A6"];
const GARMENT_FINISHED_SIZE_OPTIONS = [
  "",
  "A1",
  "A2",
  "A3",
  "A4",
  "A5",
  "A6",
  "1YRD",
  "2YRDs",
  "3YRDs",
  "4YRDs",
  "5YRDs",
  "6YRDs",
  "3FTx4FT",
  "4FTx8FT",
];
const GARMENT_PACKAGING_MODE_OPTIONS = ["", "Box Packaging", "Bag Packaging", "None"];

interface MaterialDescriptionRow {
  material: string;
  sizes: string;
  colour: string;
}

// Mirrors _new_g_item's shape from add_garment_cart_item_form
// (app.py:4000-4029) exactly — including its real asymmetries against
// PressCartItem, not "cleaned up" to match it:
//   - print_type AND type_of_print both get the SAME selected value
//     (the source writes both redundantly).
//   - finished_print_size AND yardage both get the SAME selected value
//     (same redundant-write pattern).
//   - print_size here is NOT sanitized (it's a fixed dropdown value,
//     not free text — unlike Press's sanitized free-text print_size).
//   - qty_to_pack/packaging_specs/delivery_location/delivery_contact
//     exist ONLY on Garment items — Press's _new_item has no equivalent
//     keys at all (not even nulled).
// material_description_rows exists ONLY in-memory in the source too
// ("Python-only; remove before Supabase insert", app.py:4177-4178,
// stripped again right before the Phase-3-only DB insert) — kept here
// for the same reason: a future PDF-generation consumer, never meant
// to reach the database directly.
interface GarmentCartItem {
  department: "GARMENT";
  job_description: string;
  total_amount: number;
  deposit_amount: number;
  receipt_no: string | null;
  balance_due_date: string;
  date_of_collection: string;
  qty_to_print: number;
  print_type: string;
  type_of_print: string;
  material_source: string;
  delivery_mode: string;
  print_size: string;
  finished_print_size: string;
  yardage: string;
  material_description: string;
  material_description_rows: MaterialDescriptionRow[];
  additional_comments: string;
  packaging_mode: string;
  qty_to_pack: number;
  packaging_specs: string;
  delivery_location: string;
  delivery_contact: string;
  process_info: string;
  // Press-only fields, always null on a GARMENT item — "Press-only
  // fields explicitly null for schema safety" per the source's comment.
  paper_type: null;
  gsm: null;
  paper_size: null;
  paper_colour: null;
  impressions_colour: null;
  binding_type: null;
  laminating_type: null;
}

interface GarmentItemFormState {
  desc: string;
  totalAmt: number;
  depositAmt: number;
  balanceDue: string;
  collectionDate: string;
  receiptNo: string;
  qty: number;
  materialSource: string;
  printType: string;
  deliveryMode: string;
  printSize: string;
  finishedSize: string;
  materialDesc: string;
  additionalComments: string;
  packagingMode: string;
  qtyToPack: number;
  packagingSpecs: string;
  deliveryLocation: string;
  deliveryContact: string;
  processInfo: string;
}

function blankGarmentItemForm(today: string): GarmentItemFormState {
  return {
    desc: "",
    totalAmt: 0,
    depositAmt: 0,
    balanceDue: today,
    collectionDate: today,
    receiptNo: "",
    qty: 0,
    materialSource: "",
    printType: "",
    deliveryMode: GARMENT_DELIVERY_MODE_OPTIONS[0],
    printSize: "",
    finishedSize: "",
    materialDesc: "",
    additionalComments: "",
    packagingMode: "",
    qtyToPack: 0,
    packagingSpecs: "",
    deliveryLocation: "",
    deliveryContact: "",
    processInfo: "",
  };
}

function garmentItemFormFromCartItem(item: GarmentCartItem): GarmentItemFormState {
  return {
    desc: item.job_description,
    totalAmt: item.total_amount,
    depositAmt: item.deposit_amount,
    balanceDue: item.balance_due_date,
    collectionDate: item.date_of_collection,
    receiptNo: item.receipt_no ?? "",
    qty: item.qty_to_print,
    materialSource: item.material_source,
    printType: item.print_type,
    deliveryMode: item.delivery_mode,
    printSize: item.print_size,
    finishedSize: item.finished_print_size,
    materialDesc: item.material_description,
    additionalComments: item.additional_comments,
    packagingMode: item.packaging_mode,
    qtyToPack: item.qty_to_pack,
    packagingSpecs: item.packaging_specs,
    deliveryLocation: item.delivery_location,
    deliveryContact: item.delivery_contact,
    processInfo: item.process_info,
  };
}

// Ports the material-description-to-rows split (app.py:3994-3999)
// exactly: one row per non-blank line of the (stripped) description;
// if every line is blank, a single fallback row using the RAW
// (un-stripped) description. Rows are built from trimmed lines but,
// like the source, are never run through sanitize_string() — only the
// top-level material_description field is sanitized.
function buildMaterialDescriptionRows(matDesc: string, finSize: string): MaterialDescriptionRow[] {
  const rows = matDesc
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((material) => ({ material, sizes: finSize, colour: "" }));
  if (rows.length > 0) return rows;
  return [{ material: matDesc, sizes: finSize, colour: "" }];
}

function GarmentCart({ userEmail, clients }: { userEmail: string; clients: ClientOption[] }) {
  const [today] = useState(() => todayLocalDateStr());

  const [clientSearch, setClientSearch] = useState("");
  const [selectedClientId, setSelectedClientId] = useState<number | "new" | "">("");
  const [cartClientName, setCartClientName] = useState("");
  const [cartClientPhone, setCartClientPhone] = useState("");
  const [cartClientEmail, setCartClientEmail] = useState("");
  const [cartItems, setCartItems] = useState<GarmentCartItem[]>([]);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);

  const [form, setForm] = useState<GarmentItemFormState>(() => blankGarmentItemForm(today));
  const [missingFields, setMissingFields] = useState<string[]>([]);

  const [attachments, setAttachments] = useState<AttachmentsTermsState>(blankAttachmentsTerms);
  const [isSubmitting, startSubmitTransition] = useTransition();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitWarnings, setSubmitWarnings] = useState<string[]>([]);
  const [confirmedBatch, setConfirmedBatch] = useState<Record<string, unknown>[] | null>(null);

  function startEditing(idx: number) {
    setEditingIdx(idx);
    setForm(garmentItemFormFromCartItem(cartItems[idx]));
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
    setClientSearch("");
    setSelectedClientId("");
    setCartClientName("");
    setCartClientPhone("");
    setCartClientEmail("");
    setEditingIdx(null);
  }

  function handleAddOrUpdate() {
    const missing: string[] = [];
    if (!cartClientName.trim()) missing.push("Customer Name");
    if (!cartClientPhone.trim()) missing.push("Telephone Number");
    if (!form.desc.trim()) missing.push("Item Description");
    if (form.totalAmt <= 0) missing.push("Total Item Amount");
    if (form.qty <= 0) missing.push("Quantity");
    if (!form.printType) missing.push("Print Type");
    if (!form.materialSource) missing.push("Material Source");
    if (form.depositAmt > 0 && !form.receiptNo.trim()) {
      missing.push("Receipt Number (required since a deposit was entered)");
    }

    setMissingFields(missing);
    if (missing.length > 0) return;

    const newItem: GarmentCartItem = {
      department: "GARMENT",
      job_description: sanitizeString(form.desc),
      total_amount: form.totalAmt,
      deposit_amount: form.depositAmt,
      receipt_no: form.depositAmt > 0 ? sanitizeString(form.receiptNo) : null,
      balance_due_date: form.balanceDue,
      date_of_collection: form.collectionDate,
      qty_to_print: Math.trunc(form.qty),
      print_type: form.printType,
      type_of_print: form.printType,
      material_source: form.materialSource,
      delivery_mode: form.deliveryMode,
      print_size: form.printSize,
      finished_print_size: form.finishedSize,
      yardage: form.finishedSize,
      material_description: sanitizeString(form.materialDesc),
      material_description_rows: buildMaterialDescriptionRows(form.materialDesc, form.finishedSize),
      additional_comments: sanitizeString(form.additionalComments),
      packaging_mode: form.packagingMode,
      qty_to_pack: Math.trunc(form.qtyToPack),
      packaging_specs: sanitizeString(form.packagingSpecs),
      delivery_location: sanitizeString(form.deliveryLocation),
      delivery_contact: sanitizeString(form.deliveryContact),
      process_info: sanitizeString(form.processInfo),
      paper_type: null,
      gsm: null,
      paper_size: null,
      paper_colour: null,
      impressions_colour: null,
      binding_type: null,
      laminating_type: null,
    };

    setCartClientName(cartClientName.trim());
    setCartClientPhone(cartClientPhone.trim());

    if (editingIdx !== null && editingIdx >= 0 && editingIdx < cartItems.length) {
      setCartItems((items) => items.map((it, i) => (i === editingIdx ? newItem : it)));
      setEditingIdx(null);
    } else {
      setCartItems((items) => [...items, newItem]);
    }

    setForm(blankGarmentItemForm(today));
    setMissingFields([]);
  }

  const cartTotal = cartItems.reduce((sum, it) => sum + it.total_amount, 0);
  const cartDeposit = cartItems.reduce((sum, it) => sum + it.deposit_amount, 0);
  const cartHasBalance = cartItems.some((it) => it.total_amount !== it.deposit_amount);
  const isEditing = editingIdx !== null;

  // Mirrors the Garment SUBMIT button's handler (app.py:4127-4192)
  // exactly, including its own pre-checks — re-validated server-side
  // too, since the Server Action is a real network boundary.
  function handleSubmitBatch() {
    setSubmitError(null);
    setSubmitWarnings([]);
    if (!cartClientName.trim() || !cartClientPhone.trim()) {
      setSubmitError("Client name and telephone must be set before submitting the batch.");
      return;
    }
    if (attachments.sampleAttached === "Yes" && !attachments.sampleWith.trim()) {
      setSubmitError("Sample is marked attached — enter who has it before submitting.");
      return;
    }
    // Client-side convenience copy of the same case-insensitive check
    // submitBatch runs server-side — see PressCart's identical check
    // for the full reasoning.
    if (selectedClientId === "new") {
      const dup = clients.find((c) => c.name.trim().toLowerCase() === cartClientName.trim().toLowerCase());
      if (dup) {
        setSubmitError(
          `A client named "${dup.name}" already exists (phone: ${dup.phone || "—"}). Select them from the client list instead, or adjust the name if this is a different client.`
        );
        return;
      }
    }

    const pgid = generateParentGroupId("GPG");
    const fd = new FormData();
    fd.set("pgid", pgid);
    fd.set("clientName", cartClientName);
    fd.set("clientPhone", cartClientPhone);
    fd.set("isNewClient", String(selectedClientId === "new"));
    fd.set("clientEmail", cartClientEmail);
    fd.set("items", JSON.stringify(cartItems));
    fd.set("sampleAttached", attachments.sampleAttached);
    fd.set("sampleWith", attachments.sampleWith);
    fd.set("is30Day", String(attachments.is30Day));
    fd.set("termsNotes", attachments.termsNotes);
    fd.set("salesRep", attachments.salesRep);
    if (attachments.lpoFile) fd.set("lpoFile", attachments.lpoFile);
    if (attachments.sampleFile) fd.set("sampleFile", attachments.sampleFile);

    startSubmitTransition(async () => {
      const result = await submitBatch(fd);
      if (result.error) {
        setSubmitError(result.error);
        if (result.warnings) setSubmitWarnings(result.warnings);
        return;
      }
      setConfirmedBatch(result.submitted ?? []);
      if (result.warnings) setSubmitWarnings(result.warnings);
      setCartItems([]);
      setClientSearch("");
      setSelectedClientId("");
      setCartClientName("");
      setCartClientPhone("");
      setCartClientEmail("");
      setEditingIdx(null);
      setAttachments(blankAttachmentsTerms());
    });
  }

  return (
    <div>
      {cartItems.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2 rounded-at-lg border border-amber-400 bg-gradient-to-br from-amber-50 to-amber-100 px-5 py-3.5">
          <div className="text-sm font-bold text-amber-900">
            {cartItems.length} garment item(s) in cart for {cartClientName || "—"}
          </div>
          <div className="text-xs text-amber-700">
            Add more items below, or scroll down to submit the batch
          </div>
        </div>
      )}

      {isEditing && (
        <div className="mb-3 flex items-center justify-between rounded-at border border-sky-200 bg-sky-50 px-4 py-2.5">
          <div className="text-sm text-sky-900">
            ✏️ Editing Item {(editingIdx as number) + 1} — correct the fields below and click Update.
          </div>
          <Button variant="secondary" size="sm" onClick={cancelEditing}>
            Cancel Edit
          </Button>
        </div>
      )}

      <div className="rounded-at-lg border border-at-border bg-at-white p-6 shadow-at-sm">
        <SectionHeader>Client Identity — Shared Across All Garment Items</SectionHeader>
        <ClientIdentitySection
          clients={clients}
          clientSearch={clientSearch}
          setClientSearch={setClientSearch}
          selectedClientId={selectedClientId}
          setSelectedClientId={setSelectedClientId}
          clientName={cartClientName}
          setClientName={setCartClientName}
          clientPhone={cartClientPhone}
          setClientPhone={setCartClientPhone}
          clientEmail={cartClientEmail}
          setClientEmail={setCartClientEmail}
        />

        <SectionHeader>Item Description &amp; Financial</SectionHeader>
        <div className="mb-3">
          <FormField label="Item / Job Description ★">
            <textarea
              value={form.desc}
              onChange={(e) => setForm((f) => ({ ...f, desc: e.target.value }))}
              placeholder="e.g. Custom T-Shirt DTF print, 50 pcs, White cotton..."
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

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Quantity to Print ★">
            <input
              type="number"
              min={0}
              step={10}
              value={form.qty}
              onChange={(e) => setForm((f) => ({ ...f, qty: Number(e.target.value) }))}
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </FormField>
          <FormField label="Material Source ★">
            <select
              value={form.materialSource}
              onChange={(e) => setForm((f) => ({ ...f, materialSource: e.target.value }))}
              className="w-full rounded-at border border-at-border bg-at-white px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            >
              {GARMENT_MATERIAL_SOURCE_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o || "— Select —"}
                </option>
              ))}
            </select>
          </FormField>
        </div>

        <SectionHeader>Print Type &amp; Dimensions</SectionHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Print Type ★">
            <select
              value={form.printType}
              onChange={(e) => setForm((f) => ({ ...f, printType: e.target.value }))}
              className="w-full rounded-at border border-at-border bg-at-white px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            >
              {GARMENT_PRINT_TYPE_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o || "— Select —"}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Delivery Mode ★">
            <select
              value={form.deliveryMode}
              onChange={(e) => setForm((f) => ({ ...f, deliveryMode: e.target.value }))}
              className="w-full rounded-at border border-at-border bg-at-white px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            >
              {GARMENT_DELIVERY_MODE_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </FormField>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Print Size">
            <select
              value={form.printSize}
              onChange={(e) => setForm((f) => ({ ...f, printSize: e.target.value }))}
              className="w-full rounded-at border border-at-border bg-at-white px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            >
              {GARMENT_PRINT_SIZE_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o || "— Select —"}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Finished Print Size / Yardage">
            <select
              value={form.finishedSize}
              onChange={(e) => setForm((f) => ({ ...f, finishedSize: e.target.value }))}
              className="w-full rounded-at border border-at-border bg-at-white px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            >
              {GARMENT_FINISHED_SIZE_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o || "— Select —"}
                </option>
              ))}
            </select>
          </FormField>
        </div>

        <SectionHeader>Material Description</SectionHeader>
        <div className="flex flex-col gap-3">
          <FormField label="Material Description (fabric type, colour, etc.)">
            <textarea
              value={form.materialDesc}
              onChange={(e) => setForm((f) => ({ ...f, materialDesc: e.target.value }))}
              placeholder="e.g. Cotton Jersey White, Polyester Red..."
              rows={2}
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </FormField>
          <FormField label="Additional Comments / Specifications">
            <textarea
              value={form.additionalComments}
              onChange={(e) => setForm((f) => ({ ...f, additionalComments: e.target.value }))}
              placeholder="Any other technical requirements..."
              rows={2}
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </FormField>
        </div>

        <SectionHeader>Packaging &amp; Delivery</SectionHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <FormField label="Packaging Mode">
            <select
              value={form.packagingMode}
              onChange={(e) => setForm((f) => ({ ...f, packagingMode: e.target.value }))}
              className="w-full rounded-at border border-at-border bg-at-white px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            >
              {GARMENT_PACKAGING_MODE_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o || "— Select —"}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Qty to Pack">
            <input
              type="number"
              min={0}
              step={1}
              value={form.qtyToPack}
              onChange={(e) => setForm((f) => ({ ...f, qtyToPack: Number(e.target.value) }))}
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </FormField>
          <FormField label="Packaging Specs">
            <input
              type="text"
              value={form.packagingSpecs}
              onChange={(e) => setForm((f) => ({ ...f, packagingSpecs: e.target.value }))}
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </FormField>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Delivery Location">
            <input
              type="text"
              value={form.deliveryLocation}
              onChange={(e) => setForm((f) => ({ ...f, deliveryLocation: e.target.value }))}
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </FormField>
          <FormField label="Delivery Contact Person">
            <input
              type="text"
              value={form.deliveryContact}
              onChange={(e) => setForm((f) => ({ ...f, deliveryContact: e.target.value }))}
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </FormField>
        </div>

        <SectionHeader>Process / Technical Info</SectionHeader>
        <FormField label="Process / Technical Information">
          <textarea
            value={form.processInfo}
            onChange={(e) => setForm((f) => ({ ...f, processInfo: e.target.value }))}
            placeholder="Stitching count, thread colour, press temperature..."
            rows={2}
            className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
          />
        </FormField>

        <div className="mt-4 rounded-at border border-at-border bg-at-bg px-4 py-2.5 text-xs text-at-slate">
          Handled By: {userEmail} | Date: {today}
        </div>

        {missingFields.length > 0 && (
          <div className="mt-3 text-sm font-semibold text-red-600">
            Cannot add item — missing required fields: {missingFields.join(", ")}
          </div>
        )}

        <div className="mt-4">
          <Button onClick={handleAddOrUpdate}>{isEditing ? "💾 Update Item in Cart" : "Add Item to Cart"}</Button>
        </div>
      </div>

      {cartItems.length > 0 && (
        <div className="mt-6">
          <div className="mb-3 text-base font-bold text-at-navy">
            🧵 Garment Cart — {cartItems.length} Item(s) for {cartClientName}
          </div>
          <div className="flex flex-col gap-2">
            {cartItems.map((item, idx) => {
              const preview =
                item.job_description.length > 80
                  ? `${item.job_description.slice(0, 80)}…`
                  : item.job_description;
              return (
                <div key={idx} className="flex items-center gap-2">
                  <div className="flex-1 rounded-at border border-amber-200 border-l-4 border-l-amber-500 bg-amber-50 px-4 py-3">
                    <div className="text-sm font-bold text-at-navy">
                      Item {idx + 1}: {preview}
                    </div>
                    <div className="mt-1 text-xs text-at-slate">
                      Qty: <strong>{item.qty_to_print.toLocaleString()}</strong> &nbsp;·&nbsp; Type:{" "}
                      <strong>{item.print_type}</strong> &nbsp;·&nbsp; Amount:{" "}
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

          <div
            className="mt-4 flex flex-wrap items-center gap-8 rounded-at-lg p-5 text-at-white"
            style={{ background: "linear-gradient(135deg, #78350f, #92400e)" }}
          >
            <SummaryTile label="Client" value={cartClientName || "—"} labelColor="#fde68a" />
            <SummaryTile label="Items" value={String(cartItems.length)} labelColor="#fde68a" />
            <SummaryTile label="Combined Value" value={money(cartTotal)} labelColor="#fde68a" valueColor="#fcd34d" />
            <SummaryTile
              label="Deposits Collected"
              value={money(cartDeposit)}
              labelColor="#fde68a"
              valueColor="#fcd34d"
            />
            {cartHasBalance && (
              <div className="rounded-full border border-amber-300 bg-amber-100/10 px-3 py-1 text-xs font-bold text-amber-200">
                ⚠️ Outstanding balance in this batch
              </div>
            )}
          </div>

          <AttachmentsAndTermsSection state={attachments} setState={setAttachments} cartHasBalance={cartHasBalance} />

          {submitError && <div className="mt-3 text-sm font-semibold text-red-600">{submitError}</div>}
          {submitWarnings.length > 0 &&
            submitWarnings.map((w, i) => (
              <div key={i} className="mt-3 text-sm font-semibold text-amber-600">
                {w}
              </div>
            ))}

          <div className="mt-4 flex gap-3">
            <Button disabled={isSubmitting} onClick={handleSubmitBatch}>
              {isSubmitting
                ? "SUBMITTING…"
                : `🚀 SUBMIT ${cartItems.length} GARMENT ITEM(S) FOR MANAGEMENT APPROVAL`}
            </Button>
            <Button variant="secondary" onClick={clearCart} disabled={isSubmitting}>
              🗑 Clear Cart
            </Button>
          </div>
        </div>
      )}

      {confirmedBatch && confirmedBatch.length > 0 && (
        <div className="mt-6">
          <div className="rounded-at-lg border border-green-300 bg-gradient-to-br from-green-50 to-green-100 p-5">
            <div className="mb-1 text-xs font-bold uppercase tracking-wide text-green-800">
              Garment Batch Submission Confirmed
            </div>
            <div className="text-lg font-extrabold text-at-navy">
              {confirmedBatch.length} garment item(s) deposited in management authorization ledger
            </div>
            <div className="mt-1 text-sm text-green-700">
              Batch Ref: <strong>{String(confirmedBatch[0].parent_group_id ?? "—")}</strong> &nbsp;·&nbsp; Client:{" "}
              <strong>{String(confirmedBatch[0].customer_name ?? "—")}</strong>
            </div>
          </div>
          <div className="mt-3 flex flex-col gap-2">
            {confirmedBatch.map((ticket, i) => {
              const desc = String(ticket.job_description ?? "");
              const preview = desc.length > 60 ? `${desc.slice(0, 60)}…` : desc;
              return (
                <div
                  key={i}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-at border border-at-border border-l-4 border-l-amber-500 bg-at-white px-4 py-3"
                >
                  <div>
                    <div className="text-sm font-bold text-at-navy">
                      Item {i + 1}: {preview}
                    </div>
                    <div className="mt-1 text-xs text-at-slate">
                      Ref:{" "}
                      <strong style={{ color: "#d97706" }}>{String(ticket.job_order_no ?? "PENDING")}</strong>{" "}
                      &nbsp;·&nbsp; {Number(ticket.qty_to_print ?? 0).toLocaleString()} units &nbsp;·&nbsp;{" "}
                      {String(ticket.print_type ?? "")} &nbsp;·&nbsp; {money(Number(ticket.total_amount ?? 0))}
                    </div>
                  </div>
                  <PdfPreviewButton orderId={Number(ticket.id)} label="📄 Export Garment PDF" />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// RESUBMIT (Phases 4-5) — app.py:2829-3421. Single-order forms, no
// cart: one INSERT per submit, not a batch. CRITICAL: this creates a
// NEW row — the original rejected row is never updated or touched.
// ═══════════════════════════════════════════════════════════════════

// Reads a field off the original rejected order, coalescing null/
// undefined to a fallback — the practical on-screen effect of the
// source's _rd()/_rdf()/_rdi() helpers (Streamlit's text_input/
// number_input both treat value=None the same as "use the default"),
// even though Python's dict.get(key, default) technically only falls
// back when the KEY itself is absent, which never happens here since
// resubmit_data is always a full DB row.
function rd(order: ResubmitOrderData, key: keyof ResubmitOrderData): string {
  const v = order[key];
  return v === null || v === undefined ? "" : String(v);
}
function rdNum(order: ResubmitOrderData, key: keyof ResubmitOrderData): number {
  const v = order[key];
  return v === null || v === undefined || v === ("" as unknown) ? 0 : Number(v);
}
function rdOption(order: ResubmitOrderData, key: keyof ResubmitOrderData, options: string[]): string {
  const v = rd(order, key);
  return options.includes(v) ? v : "";
}
function rdDate(order: ResubmitOrderData, key: keyof ResubmitOrderData, fallback: string): string {
  const v = order[key];
  if (typeof v === "string" && v.length >= 10) {
    const datePart = v.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return datePart;
  }
  return fallback;
}
function rdList(order: ResubmitOrderData, key: keyof ResubmitOrderData, options: string[]): Set<string> {
  const v = rd(order, key);
  if (!v || v === "None") return new Set();
  return new Set(v.split(",").map((s) => s.trim()).filter((s) => options.includes(s)));
}

// Ports the payment-terms-notes pre-fill parsing exactly
// (app.py:2914-2920 / app.py:3218-3224): if the original's payment_terms
// contains "|", everything after the FIRST "|" is the notes portion
// (strips a leading "30-Day Credit Terms" segment); otherwise, if it
// doesn't literally contain "30-Day Credit Terms", the whole string was
// just notes, so use it as-is; otherwise there were no real notes.
function parseExistingTermsNotes(paymentTerms: string): string {
  const sepIdx = paymentTerms.indexOf("|");
  if (sepIdx !== -1) {
    return paymentTerms.slice(sepIdx + 1).trim();
  }
  return paymentTerms.includes("30-Day Credit Terms") ? "" : paymentTerms;
}

// Shared by both resubmit forms — identical fields in the source for
// Press and Garment resubmit alike. Distinct from Phase 3's
// AttachmentsAndTermsSection: neither resubmit form collects a Sales
// Rep at all (rp_payload/rg_payload never include that key — not
// carried over from the original order either, ported as-is, not
// "fixed").
interface ResubmitAttachmentsState {
  lpoFile: File | null;
  sampleFile: File | null;
  sampleAttached: "No" | "Yes";
  sampleWith: string;
  is30Day: boolean;
  termsNotes: string;
}

function ResubmitAttachmentsSection({
  state,
  setState,
  hasBalance,
}: {
  state: ResubmitAttachmentsState;
  setState: React.Dispatch<React.SetStateAction<ResubmitAttachmentsState>>;
  hasBalance: boolean;
}) {
  return (
    <>
      <SectionHeader>Attachments &amp; Terms</SectionHeader>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField label="Upload LPO (optional) — goes to MD/FM">
          <input
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            onChange={(e) => setState((s) => ({ ...s, lpoFile: e.target.files?.[0] ?? null }))}
            className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
          />
        </FormField>
        <FormField label="Upload Sample Photo (optional) — goes to the department">
          <input
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            onChange={(e) => setState((s) => ({ ...s, sampleFile: e.target.files?.[0] ?? null }))}
            className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
          />
        </FormField>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField label="Sample Attached?">
          <select
            value={state.sampleAttached}
            onChange={(e) => setState((s) => ({ ...s, sampleAttached: e.target.value as "No" | "Yes" }))}
            className="w-full rounded-at border border-at-border bg-at-white px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
          >
            <option value="No">No</option>
            <option value="Yes">Yes</option>
          </select>
        </FormField>
        <FormField label="Sample With (required if Yes)">
          <input
            type="text"
            value={state.sampleWith}
            onChange={(e) => setState((s) => ({ ...s, sampleWith: e.target.value }))}
            className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
          />
        </FormField>
      </div>
      <div className="mt-3">
        <label className="flex items-center gap-2 text-sm text-at-slate">
          <input
            type="checkbox"
            checked={state.is30Day}
            onChange={(e) => setState((s) => ({ ...s, is30Day: e.target.checked }))}
          />
          30-Day Credit Terms job
        </label>
      </div>
      {hasBalance && (
        <div className="mt-3">
          <FormField label="Payment Terms Notes — not fully paid; explain the arrangement for MD/FM">
            <textarea
              value={state.termsNotes}
              onChange={(e) => setState((s) => ({ ...s, termsNotes: e.target.value }))}
              rows={2}
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </FormField>
        </div>
      )}
    </>
  );
}

function ResubmitConfirmation({ ticket }: { ticket: Record<string, unknown> }) {
  return (
    <div className="mt-6 rounded-at-lg border border-green-300 bg-gradient-to-br from-green-50 to-green-100 p-5">
      <div className="mb-1 text-xs font-bold uppercase tracking-wide text-green-800">
        Order Resubmitted
      </div>
      <div className="text-lg font-extrabold text-at-navy">
        Ref: {String(ticket.job_order_no ?? "PENDING")} — routed to management authorization queue
      </div>
      <div className="mt-3">
        <PdfPreviewButton orderId={Number(ticket.id)} label="📄 Export PDF Manifest" />
      </div>
    </div>
  );
}

function PressResubmitForm({ order, userEmail }: { order: ResubmitOrderData; userEmail: string }) {
  const [today] = useState(() => todayLocalDateStr());

  const [clientName, setClientName] = useState(() => rd(order, "customer_name"));
  const [clientPhone, setClientPhone] = useState(() => rd(order, "telephone_number"));
  const [desc, setDesc] = useState(() => rd(order, "job_description"));
  const [totalAmt, setTotalAmt] = useState(() => rdNum(order, "total_amount"));
  const [depositAmt, setDepositAmt] = useState(() => rdNum(order, "deposit_amount"));
  const [balanceDue, setBalanceDue] = useState(() => rdDate(order, "balance_due_date", today));
  const [collectionDate, setCollectionDate] = useState(() => rdDate(order, "date_of_collection", today));
  const [receiptNo, setReceiptNo] = useState(() => rd(order, "receipt_no"));
  const [qty, setQty] = useState(() => rdNum(order, "qty_to_print"));
  const [typePrint, setTypePrint] = useState(() => rdOption(order, "type_of_print", PRINT_CATEGORY_OPTIONS));
  const [materialSource, setMaterialSource] = useState(() =>
    rdOption(order, "material_source", MATERIAL_SOURCE_OPTIONS)
  );
  const [printSize, setPrintSize] = useState(() => rd(order, "print_size"));
  const [finishedSize, setFinishedSize] = useState(() => rd(order, "finished_print_size"));
  const [paperType, setPaperType] = useState(() => rd(order, "paper_type"));
  const [gsm, setGsm] = useState(() => rd(order, "gsm"));
  const [paperSize, setPaperSize] = useState(() => rd(order, "paper_size"));
  const [paperColour, setPaperColour] = useState(() => rd(order, "paper_colour"));
  const [impressionsColour, setImpressionsColour] = useState(() => rd(order, "impressions_colour"));
  const [deliveryMode, setDeliveryMode] = useState(() => {
    const v = rd(order, "delivery_mode");
    return DELIVERY_MODE_OPTIONS.includes(v) ? v : DELIVERY_MODE_OPTIONS[0];
  });
  const [binding, setBinding] = useState<Set<string>>(() => rdList(order, "binding_type", BINDING_OPTIONS));
  const [laminating, setLaminating] = useState<Set<string>>(() =>
    rdList(order, "laminating_type", LAMINATING_OPTIONS)
  );

  const [attachments, setAttachments] = useState<ResubmitAttachmentsState>(() => ({
    lpoFile: null,
    sampleFile: null,
    sampleAttached: rd(order, "sample_attached") === "Yes" ? "Yes" : "No",
    sampleWith: rd(order, "sample_with"),
    is30Day: rd(order, "payment_terms").includes("30-Day Credit Terms"),
    termsNotes: parseExistingTermsNotes(rd(order, "payment_terms")),
  }));

  const [missingFields, setMissingFields] = useState<string[]>([]);
  const [isSubmitting, startSubmitTransition] = useTransition();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitWarnings, setSubmitWarnings] = useState<string[]>([]);
  const [confirmedOrder, setConfirmedOrder] = useState<Record<string, unknown> | null>(null);

  function toggleBinding(opt: string) {
    setBinding((prev) => {
      const next = new Set(prev);
      if (next.has(opt)) next.delete(opt);
      else next.add(opt);
      return next;
    });
  }
  function toggleLaminating(opt: string) {
    setLaminating((prev) => {
      const next = new Set(prev);
      if (next.has(opt)) next.delete(opt);
      else next.add(opt);
      return next;
    });
  }

  const hasBalance = totalAmt !== depositAmt;

  function handleResubmit() {
    const missing: string[] = [];
    if (!clientName.trim()) missing.push("Customer Name");
    if (!clientPhone.trim()) missing.push("Telephone Number");
    if (!desc.trim()) missing.push("Item Description");
    if (totalAmt <= 0) missing.push("Total Item Amount");
    if (qty <= 0) missing.push("Quantity");
    if (!typePrint) missing.push("Print Category");
    if (depositAmt > 0 && !receiptNo.trim()) {
      missing.push("Receipt Number (required since a deposit was entered)");
    }
    if (attachments.sampleAttached === "Yes" && !attachments.sampleWith.trim()) {
      missing.push("Sample With (required since a sample is marked attached)");
    }

    setMissingFields(missing);
    if (missing.length > 0) return;

    setSubmitError(null);
    setSubmitWarnings([]);

    const item = {
      department: "PRESS",
      job_description: sanitizeString(desc),
      total_amount: totalAmt,
      deposit_amount: depositAmt,
      receipt_no: depositAmt > 0 ? sanitizeString(receiptNo) : null,
      balance_due_date: balanceDue,
      date_of_collection: collectionDate,
      qty_to_print: Math.trunc(qty),
      type_of_print: typePrint,
      material_source: materialSource,
      print_size: sanitizeString(printSize),
      finished_print_size: sanitizeString(finishedSize),
      paper_type: sanitizeString(paperType),
      gsm: sanitizeString(gsm),
      paper_size: sanitizeString(paperSize),
      paper_colour: sanitizeString(paperColour),
      impressions_colour: impressionsColour,
      delivery_mode: deliveryMode,
      binding_type: binding.size > 0 ? Array.from(binding).join(", ") : "None",
      laminating_type: laminating.size > 0 ? Array.from(laminating).join(", ") : "None",
      print_type: null,
      yardage: null,
      packaging_mode: null,
      process_info: null,
      material_description: null,
    };

    const fd = new FormData();
    fd.set("originalParentGroupId", order.parent_group_id ?? "");
    fd.set("clientName", clientName);
    fd.set("clientPhone", clientPhone);
    fd.set("item", JSON.stringify(item));
    fd.set("sampleAttached", attachments.sampleAttached);
    fd.set("sampleWith", attachments.sampleWith);
    fd.set("is30Day", String(attachments.is30Day));
    fd.set("termsNotes", attachments.termsNotes);
    if (attachments.lpoFile) fd.set("lpoFile", attachments.lpoFile);
    if (attachments.sampleFile) fd.set("sampleFile", attachments.sampleFile);

    startSubmitTransition(async () => {
      const result = await resubmitOrderAction(fd);
      if (result.error) {
        setSubmitError(result.error);
        if (result.warnings) setSubmitWarnings(result.warnings);
        return;
      }
      setConfirmedOrder(result.submitted?.[0] ?? null);
      if (result.warnings) setSubmitWarnings(result.warnings);
    });
  }

  return (
    <div>
      <div className="rounded-at-lg border border-at-border bg-at-white p-6 shadow-at-sm">
        <SectionHeader>Client Identity &amp; Contract Outline</SectionHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Customer Name ★">
            <input
              type="text"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </FormField>
          <FormField label="Telephone Number ★">
            <input
              type="text"
              value={clientPhone}
              onChange={(e) => setClientPhone(e.target.value)}
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </FormField>
        </div>
        <div className="mt-3">
          <FormField label="Item Description ★">
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              rows={2}
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </FormField>
        </div>

        <SectionHeader>Financial Ledgers &amp; Scheduling</SectionHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <FormField label={`Total Item Amount (${CURRENCY}) ★`}>
            <input
              type="number"
              min={0}
              step={100}
              value={totalAmt}
              onChange={(e) => setTotalAmt(Number(e.target.value))}
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </FormField>
          <FormField label={`Deposit Paid (${CURRENCY})`}>
            <input
              type="number"
              min={0}
              step={100}
              value={depositAmt}
              onChange={(e) => setDepositAmt(Number(e.target.value))}
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </FormField>
          <FormField label="Balance Deadline ★">
            <input
              type="date"
              value={balanceDue}
              onChange={(e) => setBalanceDue(e.target.value)}
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </FormField>
          <FormField label="Collection Date ★">
            <input
              type="date"
              value={collectionDate}
              onChange={(e) => setCollectionDate(e.target.value)}
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </FormField>
        </div>
        <div className="mt-3 max-w-sm">
          <FormField label="Receipt Number (required if a deposit is entered)">
            <input
              type="text"
              value={receiptNo}
              onChange={(e) => setReceiptNo(e.target.value)}
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </FormField>
        </div>

        <ResubmitAttachmentsSection state={attachments} setState={setAttachments} hasBalance={hasBalance} />

        <SectionHeader>Production Quantity &amp; Category</SectionHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <FormField label="Quantity ★">
            <input
              type="number"
              min={0}
              step={500}
              value={qty}
              onChange={(e) => setQty(Number(e.target.value))}
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </FormField>
          <FormField label="Print Category ★">
            <select
              value={typePrint}
              onChange={(e) => setTypePrint(e.target.value)}
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
              value={materialSource}
              onChange={(e) => setMaterialSource(e.target.value)}
              className="w-full rounded-at border border-at-border bg-at-white px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            >
              {MATERIAL_SOURCE_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o || "— Select —"}
                </option>
              ))}
            </select>
          </FormField>
        </div>
        <div className="mt-3 max-w-xs">
          <FormField label="Delivery Mode">
            <select
              value={deliveryMode}
              onChange={(e) => setDeliveryMode(e.target.value)}
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
              value={printSize}
              onChange={(e) => setPrintSize(e.target.value)}
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </FormField>
          <FormField label="Finished Size">
            <input
              type="text"
              value={finishedSize}
              onChange={(e) => setFinishedSize(e.target.value)}
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </FormField>
          <FormField label="Paper Material">
            <input
              type="text"
              value={paperType}
              onChange={(e) => setPaperType(e.target.value)}
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </FormField>
          <FormField label="GSM">
            <input
              type="text"
              value={gsm}
              onChange={(e) => setGsm(e.target.value)}
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </FormField>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <FormField label="Paper Size">
            <input
              type="text"
              value={paperSize}
              onChange={(e) => setPaperSize(e.target.value)}
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </FormField>
          <FormField label="Colour / Ink Specs">
            <input
              type="text"
              value={paperColour}
              onChange={(e) => setPaperColour(e.target.value)}
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </FormField>
          <FormField label="Impressions">
            <input
              type="text"
              value={impressionsColour}
              onChange={(e) => setImpressionsColour(e.target.value)}
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </FormField>
        </div>

        <div className="mt-4">
          <div className="mb-1.5 text-sm font-semibold text-at-navy">Binding Selection</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {BINDING_OPTIONS.map((o) => (
              <label key={o} className="flex items-center gap-2 text-sm text-at-slate">
                <input type="checkbox" checked={binding.has(o)} onChange={() => toggleBinding(o)} />
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
                <input type="checkbox" checked={laminating.has(o)} onChange={() => toggleLaminating(o)} />
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
            Transaction blocked. Missing required fields: {missingFields.join(", ")}
          </div>
        )}
        {submitError && <div className="mt-3 text-sm font-semibold text-red-600">{submitError}</div>}
        {submitWarnings.map((w, i) => (
          <div key={i} className="mt-3 text-sm font-semibold text-amber-600">
            {w}
          </div>
        ))}

        <div className="mt-4">
          <Button disabled={isSubmitting} onClick={handleResubmit}>
            {isSubmitting ? "RESUBMITTING…" : "🔄 RESUBMIT FOR MANAGEMENT APPROVAL"}
          </Button>
        </div>
      </div>

      {confirmedOrder && <ResubmitConfirmation ticket={confirmedOrder} />}
    </div>
  );
}

function GarmentResubmitForm({ order, userEmail }: { order: ResubmitOrderData; userEmail: string }) {
  const [today] = useState(() => todayLocalDateStr());

  const [clientName, setClientName] = useState(() => rd(order, "customer_name"));
  const [clientPhone, setClientPhone] = useState(() => rd(order, "telephone_number"));
  const [desc, setDesc] = useState(() => rd(order, "job_description"));
  const [totalAmt, setTotalAmt] = useState(() => rdNum(order, "total_amount"));
  const [depositAmt, setDepositAmt] = useState(() => rdNum(order, "deposit_amount"));
  const [balanceDue, setBalanceDue] = useState(() => rdDate(order, "balance_due_date", today));
  const [collectionDate, setCollectionDate] = useState(() => rdDate(order, "date_of_collection", today));
  const [receiptNo, setReceiptNo] = useState(() => rd(order, "receipt_no"));
  const [qty, setQty] = useState(() => rdNum(order, "qty_to_print"));
  const [materialSource, setMaterialSource] = useState(() =>
    rdOption(order, "material_source", GARMENT_MATERIAL_SOURCE_OPTIONS)
  );
  const [printType, setPrintType] = useState(() => {
    const v = rd(order, "print_type") || rd(order, "type_of_print");
    return GARMENT_PRINT_TYPE_OPTIONS.includes(v) ? v : "";
  });
  const [deliveryMode, setDeliveryMode] = useState(() => {
    const v = rd(order, "delivery_mode");
    return GARMENT_DELIVERY_MODE_OPTIONS.includes(v) ? v : GARMENT_DELIVERY_MODE_OPTIONS[0];
  });
  const [printSize, setPrintSize] = useState(() => rdOption(order, "print_size", GARMENT_PRINT_SIZE_OPTIONS));
  const [finishedSize, setFinishedSize] = useState(() => {
    const v = rd(order, "finished_print_size") || rd(order, "yardage");
    return GARMENT_FINISHED_SIZE_OPTIONS.includes(v) ? v : "";
  });
  const [materialDesc, setMaterialDesc] = useState(() => rd(order, "material_description"));
  const [additionalComments, setAdditionalComments] = useState(() => rd(order, "additional_comments"));
  const [packagingMode, setPackagingMode] = useState(() =>
    rdOption(order, "packaging_mode", GARMENT_PACKAGING_MODE_OPTIONS)
  );
  const [qtyToPack, setQtyToPack] = useState(() => rdNum(order, "qty_to_pack"));
  const [packagingSpecs, setPackagingSpecs] = useState(() => rd(order, "packaging_specs"));
  const [deliveryLocation, setDeliveryLocation] = useState(() => rd(order, "delivery_location"));
  const [deliveryContact, setDeliveryContact] = useState(() => rd(order, "delivery_contact"));
  const [processInfo, setProcessInfo] = useState(() => rd(order, "process_info"));

  const [attachments, setAttachments] = useState<ResubmitAttachmentsState>(() => ({
    lpoFile: null,
    sampleFile: null,
    sampleAttached: rd(order, "sample_attached") === "Yes" ? "Yes" : "No",
    sampleWith: rd(order, "sample_with"),
    is30Day: rd(order, "payment_terms").includes("30-Day Credit Terms"),
    termsNotes: parseExistingTermsNotes(rd(order, "payment_terms")),
  }));

  const [missingFields, setMissingFields] = useState<string[]>([]);
  const [isSubmitting, startSubmitTransition] = useTransition();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitWarnings, setSubmitWarnings] = useState<string[]>([]);
  const [confirmedOrder, setConfirmedOrder] = useState<Record<string, unknown> | null>(null);

  const hasBalance = totalAmt !== depositAmt;

  function handleResubmit() {
    const missing: string[] = [];
    if (!clientName.trim()) missing.push("Customer Name");
    if (!clientPhone.trim()) missing.push("Telephone Number");
    if (!desc.trim()) missing.push("Job Description");
    if (totalAmt <= 0) missing.push("Total Item Amount");
    if (qty <= 0) missing.push("Quantity to Print");
    if (!printType) missing.push("Print Type");
    if (!materialSource) missing.push("Material Source");
    if (depositAmt > 0 && !receiptNo.trim()) {
      missing.push("Receipt Number (required since a deposit was entered)");
    }
    if (attachments.sampleAttached === "Yes" && !attachments.sampleWith.trim()) {
      missing.push("Sample With (required since a sample is marked attached)");
    }

    setMissingFields(missing);
    if (missing.length > 0) return;

    setSubmitError(null);
    setSubmitWarnings([]);

    // Build material_description_rows for PDF compatibility (app.py:3050-3060)
    // — Python-only, stripped server-side before the insert, same as
    // GarmentCartItem's own field.
    const materialDescriptionRows = (() => {
      const rows = materialDesc
        .trim()
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((material) => ({ material, sizes: finishedSize, colour: "" }));
      if (rows.length > 0) return rows;
      return [{ material: materialDesc, sizes: finishedSize, colour: "" }];
    })();

    const item = {
      department: "GARMENT",
      job_description: sanitizeString(desc),
      total_amount: totalAmt,
      deposit_amount: depositAmt,
      receipt_no: depositAmt > 0 ? sanitizeString(receiptNo) : null,
      balance_due_date: balanceDue,
      date_of_collection: collectionDate,
      qty_to_print: Math.trunc(qty),
      print_type: printType,
      type_of_print: printType,
      material_source: materialSource,
      delivery_mode: deliveryMode,
      print_size: printSize,
      finished_print_size: finishedSize,
      yardage: finishedSize,
      material_description: sanitizeString(materialDesc),
      material_description_rows: materialDescriptionRows,
      additional_comments: sanitizeString(additionalComments),
      packaging_mode: packagingMode,
      qty_to_pack: Math.trunc(qtyToPack),
      packaging_specs: sanitizeString(packagingSpecs),
      delivery_location: sanitizeString(deliveryLocation),
      delivery_contact: sanitizeString(deliveryContact),
      process_info: sanitizeString(processInfo),
      paper_type: null,
      gsm: null,
      paper_size: null,
      paper_colour: null,
      impressions_colour: null,
      binding_type: null,
      laminating_type: null,
    };

    const fd = new FormData();
    fd.set("originalParentGroupId", order.parent_group_id ?? "");
    fd.set("clientName", clientName);
    fd.set("clientPhone", clientPhone);
    fd.set("item", JSON.stringify(item));
    fd.set("sampleAttached", attachments.sampleAttached);
    fd.set("sampleWith", attachments.sampleWith);
    fd.set("is30Day", String(attachments.is30Day));
    fd.set("termsNotes", attachments.termsNotes);
    if (attachments.lpoFile) fd.set("lpoFile", attachments.lpoFile);
    if (attachments.sampleFile) fd.set("sampleFile", attachments.sampleFile);

    startSubmitTransition(async () => {
      const result = await resubmitOrderAction(fd);
      if (result.error) {
        setSubmitError(result.error);
        if (result.warnings) setSubmitWarnings(result.warnings);
        return;
      }
      setConfirmedOrder(result.submitted?.[0] ?? null);
      if (result.warnings) setSubmitWarnings(result.warnings);
    });
  }

  return (
    <div>
      <div className="rounded-at-lg border border-at-border bg-at-white p-6 shadow-at-sm">
        <SectionHeader>Client Identity &amp; Contract Outline</SectionHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Customer Name ★">
            <input
              type="text"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </FormField>
          <FormField label="Telephone Number ★">
            <input
              type="text"
              value={clientPhone}
              onChange={(e) => setClientPhone(e.target.value)}
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </FormField>
        </div>
        <div className="mt-3">
          <FormField label="Job / Item Description ★">
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              rows={2}
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </FormField>
        </div>

        <SectionHeader>Financial Ledgers &amp; Scheduling</SectionHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <FormField label={`Total Item Amount (${CURRENCY}) ★`}>
            <input
              type="number"
              min={0}
              step={100}
              value={totalAmt}
              onChange={(e) => setTotalAmt(Number(e.target.value))}
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </FormField>
          <FormField label={`Deposit Paid (${CURRENCY})`}>
            <input
              type="number"
              min={0}
              step={100}
              value={depositAmt}
              onChange={(e) => setDepositAmt(Number(e.target.value))}
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </FormField>
          <FormField label="Balance Deadline ★">
            <input
              type="date"
              value={balanceDue}
              onChange={(e) => setBalanceDue(e.target.value)}
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </FormField>
          <FormField label="Collection Date ★">
            <input
              type="date"
              value={collectionDate}
              onChange={(e) => setCollectionDate(e.target.value)}
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </FormField>
        </div>
        <div className="mt-3 max-w-sm">
          <FormField label="Receipt Number (required if a deposit is entered)">
            <input
              type="text"
              value={receiptNo}
              onChange={(e) => setReceiptNo(e.target.value)}
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </FormField>
        </div>

        <ResubmitAttachmentsSection state={attachments} setState={setAttachments} hasBalance={hasBalance} />

        <SectionHeader>Production Quantity &amp; Sourcing</SectionHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Quantity to Print ★">
            <input
              type="number"
              min={0}
              step={10}
              value={qty}
              onChange={(e) => setQty(Number(e.target.value))}
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </FormField>
          <FormField label="Material Source ★">
            <select
              value={materialSource}
              onChange={(e) => setMaterialSource(e.target.value)}
              className="w-full rounded-at border border-at-border bg-at-white px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            >
              {GARMENT_MATERIAL_SOURCE_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o || "— Select —"}
                </option>
              ))}
            </select>
          </FormField>
        </div>

        <SectionHeader>Print Type &amp; Dimensions</SectionHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Print Type ★">
            <select
              value={printType}
              onChange={(e) => setPrintType(e.target.value)}
              className="w-full rounded-at border border-at-border bg-at-white px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            >
              {GARMENT_PRINT_TYPE_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o || "— Select —"}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Delivery Mode ★">
            <select
              value={deliveryMode}
              onChange={(e) => setDeliveryMode(e.target.value)}
              className="w-full rounded-at border border-at-border bg-at-white px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            >
              {GARMENT_DELIVERY_MODE_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </FormField>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Print Size">
            <select
              value={printSize}
              onChange={(e) => setPrintSize(e.target.value)}
              className="w-full rounded-at border border-at-border bg-at-white px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            >
              {GARMENT_PRINT_SIZE_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o || "— Select —"}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Finished Print Size / Yardage">
            <select
              value={finishedSize}
              onChange={(e) => setFinishedSize(e.target.value)}
              className="w-full rounded-at border border-at-border bg-at-white px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            >
              {GARMENT_FINISHED_SIZE_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o || "— Select —"}
                </option>
              ))}
            </select>
          </FormField>
        </div>

        <SectionHeader>Material Description</SectionHeader>
        <div className="flex flex-col gap-3">
          <FormField label="Material Description (fabric type, colour, etc.)">
            <textarea
              value={materialDesc}
              onChange={(e) => setMaterialDesc(e.target.value)}
              rows={2}
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </FormField>
          <FormField label="Additional Comments / Specifications">
            <textarea
              value={additionalComments}
              onChange={(e) => setAdditionalComments(e.target.value)}
              rows={2}
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </FormField>
        </div>

        <SectionHeader>Packaging &amp; Delivery</SectionHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <FormField label="Packaging Mode">
            <select
              value={packagingMode}
              onChange={(e) => setPackagingMode(e.target.value)}
              className="w-full rounded-at border border-at-border bg-at-white px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            >
              {GARMENT_PACKAGING_MODE_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o || "— Select —"}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Qty to Pack">
            <input
              type="number"
              min={0}
              step={1}
              value={qtyToPack}
              onChange={(e) => setQtyToPack(Number(e.target.value))}
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </FormField>
          <FormField label="Packaging Specs">
            <input
              type="text"
              value={packagingSpecs}
              onChange={(e) => setPackagingSpecs(e.target.value)}
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </FormField>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Delivery Location">
            <input
              type="text"
              value={deliveryLocation}
              onChange={(e) => setDeliveryLocation(e.target.value)}
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </FormField>
          <FormField label="Delivery Contact Person">
            <input
              type="text"
              value={deliveryContact}
              onChange={(e) => setDeliveryContact(e.target.value)}
              className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
          </FormField>
        </div>

        <SectionHeader>Process / Technical Info</SectionHeader>
        <FormField label="Process / Technical Information">
          <textarea
            value={processInfo}
            onChange={(e) => setProcessInfo(e.target.value)}
            rows={2}
            className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
          />
        </FormField>

        <div className="mt-4 rounded-at border border-at-border bg-at-bg px-4 py-2.5 text-xs text-at-slate">
          Handled By: {userEmail} | Date: {today}
        </div>

        {missingFields.length > 0 && (
          <div className="mt-3 text-sm font-semibold text-red-600">
            Transaction blocked. Missing required fields: {missingFields.join(", ")}
          </div>
        )}
        {submitError && <div className="mt-3 text-sm font-semibold text-red-600">{submitError}</div>}
        {submitWarnings.map((w, i) => (
          <div key={i} className="mt-3 text-sm font-semibold text-amber-600">
            {w}
          </div>
        ))}

        <div className="mt-4">
          <Button disabled={isSubmitting} onClick={handleResubmit}>
            {isSubmitting ? "RESUBMITTING…" : "🔄 RESUBMIT FOR MANAGEMENT APPROVAL"}
          </Button>
        </div>
      </div>

      {confirmedOrder && <ResubmitConfirmation ticket={confirmedOrder} />}
    </div>
  );
}
