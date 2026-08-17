"use client";

import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { PdfPreviewButton } from "@/components/ui/pdf-preview-button";
import { isGarment, type GarmentClassifiable } from "@/lib/is-garment";
import { recordPayment, reviseOrder, deleteMasterOrder, reopenOrder, getAttachmentSignedUrl } from "./actions";

const CURRENCY = "GH₵";

const GARMENT_CATEGORIES = ["DTF", "Flexi Screen Print", "UV-DTF", "SAV", "Embroidery"];
const PRESS_CATEGORIES = ["OFFSET", "DIGITAL PRESS", "PACKAGING"];

export interface ArchiveOrderRow extends GarmentClassifiable {
  id: number;
  job_order_no: string | null;
  customer_name: string;
  client_id: number | null;
  is_sample: boolean;
  sample_reason: string | null;
  status: string | null;
  total_amount: number | null;
  deposit_amount: number | null;
  qty_to_print: number | null;
  date_of_collection: string | null;
  approved_by: string | null;
  // Raw Storage object PATH (bucket is private) — signed on demand for viewing.
  lpo_file_url: string | null;
  sample_file_url: string | null;
}

// Ports the edit form's category dropdown exactly (app.py:5177-5191):
// garment orders read type_of_print with a print_type fallback and keep
// original casing; non-garment orders read type_of_print only and
// uppercase it — reviseOrder always WRITES type_of_print regardless of
// which branch supplied the initial value. Either way, if the order's
// current value isn't already in the fixed list, it's appended so it
// doesn't silently disappear from the dropdown (and is pre-selected,
// matching the source's index-into-list-after-append behavior).
function buildCategoryOptions(order: ArchiveOrderRow, garment: boolean): { options: string[]; current: string } {
  if (garment) {
    const current = (order.type_of_print || order.print_type || "").trim();
    const options = GARMENT_CATEGORIES.includes(current) ? GARMENT_CATEGORIES : [...GARMENT_CATEGORIES, current];
    return { options, current };
  }
  const current = (order.type_of_print || "").trim().toUpperCase();
  const options = PRESS_CATEGORIES.includes(current) ? PRESS_CATEGORIES : [...PRESS_CATEGORIES, current];
  return { options, current };
}

interface StatusTab {
  status: string;
  tabLabel: string;
  fullLabel: string;
}

// Tab caption uses a short label ("Ready"); export button, CSV filename,
// and empty-state message all use the full status string ("Ready for
// Collection") — that split exists in the real source too, not a
// simplification on my end.
const STATUS_TABS: StatusTab[] = [
  { status: "Approved", tabLabel: "Approved", fullLabel: "Approved" },
  { status: "In Production", tabLabel: "In Production", fullLabel: "In Production" },
  { status: "At Warehouse", tabLabel: "At Warehouse", fullLabel: "At Warehouse" },
  { status: "Ready for Collection", tabLabel: "Ready", fullLabel: "Ready for Collection" },
  { status: "Delivered", tabLabel: "Delivered", fullLabel: "Delivered" },
];

function money(n: number): string {
  return `${CURRENCY}${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function downloadCsv(fullLabel: string, rows: ArchiveOrderRow[]) {
  const columns = [
    "Order No",
    "Customer",
    "Dept",
    `Total (${CURRENCY})`,
    `Deposit (${CURRENCY})`,
    `Balance (${CURRENCY})`,
    "Collection",
    "Auth By",
  ];
  const lines = [
    columns.join(","),
    ...rows.map((order) => {
      const total = Number(order.total_amount ?? 0);
      const deposit = Number(order.deposit_amount ?? 0);
      const balance = total - deposit; // not clamped — matches this route's source
      return [
        order.job_order_no ?? "",
        order.customer_name ?? "",
        isGarment(order) ? "GARMENT" : "PRESS",
        total.toFixed(2),
        deposit.toFixed(2),
        balance.toFixed(2),
        order.date_of_collection ?? "",
        order.approved_by ?? "",
      ]
        .map((v) => csvEscape(String(v)))
        .join(",");
    }),
  ];
  const csv = lines.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  link.href = url;
  link.download = `ATP_${fullLabel.replace(/ /g, "_")}_${yyyy}${mm}${dd}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function ArchiveClient({ orders }: { orders: ArchiveOrderRow[] }) {
  const [activeTab, setActiveTab] = useState(0);

  const byStatus = useMemo(() => {
    return STATUS_TABS.map((tab) => ({
      ...tab,
      rows: orders.filter((order) => order.status === tab.status),
    }));
  }, [orders]);

  const current = byStatus[activeTab];

  return (
    <div>
      <div className="mb-4 flex gap-1 border-b border-at-border">
        {byStatus.map((tab, i) => (
          <button
            key={tab.status}
            type="button"
            onClick={() => setActiveTab(i)}
            className={`px-4 py-2.5 text-sm font-bold transition-colors ${
              activeTab === i
                ? "border-b-2 border-at-navy text-at-navy"
                : "text-at-slate hover:text-at-navy"
            }`}
          >
            {tab.tabLabel} ({tab.rows.length})
          </button>
        ))}
      </div>

      {current.rows.length === 0 ? (
        <div className="rounded-at-lg border border-at-border bg-at-white p-6 text-sm text-at-slate shadow-at-sm">
          No orders with status &apos;{current.fullLabel}&apos;.
        </div>
      ) : (
        <div>
          <div className="mb-3 flex justify-end">
            <Button onClick={() => downloadCsv(current.fullLabel, current.rows)}>
              Export {current.fullLabel} CSV
            </Button>
          </div>

          <div className="overflow-x-auto rounded-at-lg border border-at-border bg-at-white shadow-at-sm">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-at-border bg-at-bg">
                  {[
                    "Order No",
                    "Customer",
                    "Dept",
                    `Total (${CURRENCY})`,
                    `Deposit (${CURRENCY})`,
                    `Balance (${CURRENCY})`,
                    "Collection",
                    "Auth By",
                  ].map((col) => (
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
                {current.rows.map((order) => {
                  const total = Number(order.total_amount ?? 0);
                  const deposit = Number(order.deposit_amount ?? 0);
                  const balance = total - deposit; // not clamped
                  const garment = isGarment(order);
                  return (
                    <tr key={order.id} className="border-b border-at-border last:border-0 hover:bg-at-bg">
                      <td className="whitespace-nowrap px-4 py-2.5 text-at-navy">
                        <span className="flex items-center gap-2">
                          {order.job_order_no || "—"}
                          {order.is_sample && (
                            <StatusBadge label="SAMPLE" tone="sample" title={order.sample_reason ?? undefined} />
                          )}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-at-navy">
                        {order.customer_name || "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-at-navy">
                        {garment ? "GARMENT" : "PRESS"}
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
                      <td className="whitespace-nowrap px-4 py-2.5 text-at-navy">
                        {order.approved_by || "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ManageArchivedOrders orders={orders} />
    </div>
  );
}

// Ports "Manage Archived Orders" (app.py:5056-5145). Reuses the same
// `orders` already fetched for the tabs above — no new query, matching
// the source's own approved_orders reuse. Phase 1 of this section:
// balance payment + PDF export only. Master Order Revision and Delete
// Master Order are deliberately not built — held pending product
// decisions (the edit form's re-routing side effect, and a
// type-to-confirm delete gate) — see MIGRATION_STATUS.md.
function ManageArchivedOrders({ orders }: { orders: ArchiveOrderRow[] }) {
  const [search, setSearch] = useState("");
  const [selectedOrderNo, setSelectedOrderNo] = useState("");

  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((o) => {
      const orderNo = (o.job_order_no ?? "").toLowerCase();
      const customer = (o.customer_name ?? "").toLowerCase();
      return orderNo.includes(q) || customer.includes(q);
    });
  }, [orders, search]);

  const target = orders.find((o) => o.job_order_no === selectedOrderNo) ?? null;

  return (
    <div className="mt-8 border-t-2 border-slate-100 pt-6">
      <div className="mb-3 text-base font-bold text-at-navy">Manage Archived Orders</div>

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by order number or customer name — e.g. P966102 or NUTRIFOODS"
        className="mb-3 w-full rounded-at border border-at-border bg-at-white px-4 py-2.5 text-sm text-at-navy outline-none focus:border-at-accent"
      />

      <select
        value={selectedOrderNo}
        onChange={(e) => setSelectedOrderNo(e.target.value)}
        className="w-full max-w-xl rounded-at border border-at-border bg-at-white px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
      >
        <option value="">— Select an order —</option>
        {candidates
          .filter((o): o is ArchiveOrderRow & { job_order_no: string } => Boolean(o.job_order_no))
          .map((o) => (
            <option key={o.id} value={o.job_order_no}>
              {o.job_order_no} — {o.customer_name || "—"} · {o.status || "—"}
            </option>
          ))}
      </select>

      {candidates.length === 0 && (
        <div className="mt-3 text-sm text-at-slate">No orders match your search.</div>
      )}

      {target && <OrderOperationsPanel key={target.id} order={target} />}
    </div>
  );
}

function OrderOperationsPanel({ order }: { order: ArchiveOrderRow }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const total = Number(order.total_amount ?? 0);
  const deposit = Number(order.deposit_amount ?? 0);
  const balance = total - deposit; // not clamped — matches this route's existing balance convention
  const garment = isGarment(order);

  const [payAmt, setPayAmt] = useState(balance > 0 ? balance : 0);
  const [receiptNo, setReceiptNo] = useState("");

  function handleRecordPayment() {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      // recordPayment now takes the INCREMENTAL payment amount only —
      // it re-fetches the real current deposit_amount server-side and
      // computes the new cumulative total itself (fixed: previously
      // this component computed deposit + payAmt and the action wrote
      // that as-is). No longer showing a "new deposit total" in the
      // success message since that value is no longer computed
      // client-side and isn't returned by the action.
      const result = await recordPayment(order.id, payAmt, receiptNo);
      if (result.error) {
        setError(result.error);
      } else {
        setSuccess(`Payment of ${money(payAmt)} recorded.`);
      }
    });
  }

  return (
    <div className="mt-4 rounded-at-lg border border-at-border bg-at-white p-6 shadow-at-sm">
      <div className="mb-4 flex items-center gap-2 text-sm font-bold text-at-navy">
        Order Operations: {order.job_order_no}
        {order.is_sample && (
          <StatusBadge label="SAMPLE" tone="sample" title={order.sample_reason ?? undefined} />
        )}
      </div>

      {balance > 0 ? (
        <div className="mb-5 border-t border-at-border pt-4">
          <div className="mb-2 text-sm font-bold text-at-navy">💰 Record Balance Payment</div>
          <div className="mb-3">
            <div className="text-xs text-at-slate">Outstanding Balance</div>
            <div className="text-xl font-extrabold text-red-600">{money(balance)}</div>
          </div>
          <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
                Payment Amount
              </label>
              <input
                type="number"
                min={0.01}
                max={balance}
                step={100}
                value={payAmt}
                onChange={(e) => setPayAmt(Number(e.target.value))}
                className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
              />
            </div>
            <div>
              <label className="mb-1 block text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
                Receipt Number
              </label>
              <input
                type="text"
                value={receiptNo}
                onChange={(e) => setReceiptNo(e.target.value)}
                placeholder="e.g. RCT-00123 — optional, recommended for the audit trail"
                className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
              />
            </div>
          </div>
          {error && <div className="mb-3 text-sm font-semibold text-red-600">{error}</div>}
          {success && <div className="mb-3 text-sm font-semibold text-emerald-600">{success}</div>}
          <Button disabled={isPending || payAmt <= 0 || payAmt > balance} onClick={handleRecordPayment}>
            ✓ Record Payment
          </Button>
        </div>
      ) : total > 0 ? (
        <div className="mb-5 border-t border-at-border pt-4">
          <div className="inline-block rounded-md border border-green-200 bg-green-50 px-3.5 py-2 text-sm font-semibold text-green-800">
            ✅ Fully Paid — {money(total)}
          </div>
        </div>
      ) : null}

      <div className="border-t border-at-border pt-4">
        <PdfPreviewButton
          orderId={order.id}
          label={garment ? "🧵 Export Garment PDF Manifest" : "📄 Export Official PDF Manifest"}
        />
      </div>

      <AttachmentsSection order={order} />
      <RevisionForm order={order} garment={garment} />
      <DeleteMasterOrderSection order={order} />
      {order.status === "Delivered" && <ReopenOrderSection order={order} />}
    </div>
  );
}

// One attachment link. The bucket is private and the stored value is a raw
// object path, so the signed URL is fetched FRESH from the server on click
// (never a stored, expiring value) and opened in a new tab.
function AttachmentLink({ pathOrUrl, label, icon }: { pathOrUrl: string; label: string; icon: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function open() {
    setError(null);
    startTransition(async () => {
      const result = await getAttachmentSignedUrl(pathOrUrl);
      if (result.error || !result.url) {
        setError(result.error ?? "Could not open this attachment.");
        return;
      }
      window.open(result.url, "_blank", "noopener,noreferrer");
    });
  }

  return (
    <div>
      <Button variant="secondary" disabled={isPending} onClick={open}>
        {isPending ? "Opening…" : `${icon} ${label}`}
      </Button>
      {error && <div className="mt-1 text-xs font-semibold text-red-600">{error}</div>}
    </div>
  );
}

function AttachmentsSection({ order }: { order: ArchiveOrderRow }) {
  if (!order.lpo_file_url && !order.sample_file_url) return null;
  return (
    <div className="mt-5 border-t border-at-border pt-4">
      <div className="mb-2 text-sm font-bold text-at-navy">📎 Attachments</div>
      <div className="flex flex-wrap gap-3">
        {order.lpo_file_url && (
          <AttachmentLink pathOrUrl={order.lpo_file_url} label="View LPO" icon="📄" />
        )}
        {order.sample_file_url && (
          <AttachmentLink pathOrUrl={order.sample_file_url} label="View Sample Photo" icon="🖼️" />
        )}
      </div>
      <div className="mt-1.5 text-[0.7rem] text-at-slate">
        Opens a fresh, time-limited secure link (generated on click).
      </div>
    </div>
  );
}

function RevisionForm({ order, garment }: { order: ArchiveOrderRow; garment: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [customerName, setCustomerName] = useState(order.customer_name);
  const [qty, setQty] = useState(order.qty_to_print ?? 0);
  const [totalAmt, setTotalAmt] = useState(Number(order.total_amount ?? 0));
  const [depositAmt, setDepositAmt] = useState(Number(order.deposit_amount ?? 0));

  const { options: categoryOptions, current: initialCategory } = useMemo(
    () => buildCategoryOptions(order, garment),
    [order, garment]
  );
  const [category, setCategory] = useState(initialCategory);

  function handleSave() {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await reviseOrder(order.id, {
        customerName,
        qtyToPrint: qty,
        totalAmount: totalAmt,
        depositAmount: depositAmt,
        typeOfPrint: category,
      });
      if (result.error) {
        setError(result.error);
      } else {
        setSuccess(
          `Order ${order.job_order_no} revised successfully. Status set to 'Pending Revision Approval' — removed from production archive and re-routed to Authorization Center for fresh management sign-off.`
        );
      }
    });
  }

  return (
    <div className="mt-4 border-t border-at-border pt-4">
      <div className="mb-3 text-base font-semibold text-at-navy">Master Order Revision Interface</div>

      <div className="mb-4 rounded-lg border border-amber-300 border-l-4 border-l-amber-600 bg-gradient-to-br from-amber-50 to-amber-100 px-4 py-3">
        <div className="mb-1 text-[0.72rem] font-bold uppercase tracking-wide text-amber-800">
          ⚠️ Revision Lifecycle Notice
        </div>
        <div className="text-sm text-amber-900">
          Saving changes will move this order from <strong>Approved</strong> →{" "}
          <strong>Pending Revision Approval</strong> and re-route it to the Authorization Center
          for fresh management sign-off. The original Job Order No. and Batch Reference are
          preserved for audit traceability.
        </div>
      </div>

      <div className="mb-2 text-sm font-bold text-at-navy">Client Identity</div>
      <div className="mb-4">
        <label className="mb-1 block text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
          Customer Name
        </label>
        <input
          type="text"
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
          className="w-full max-w-md rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
        />
        <div className="mt-1 text-xs text-at-slate">
          {order.client_id
            ? "This order is linked to a real client record — correcting the name here updates that client's canonical record, so the fix applies everywhere that client is referenced going forward (Sales Rep Dashboard, future orders, Global Search), not just this order."
            : "This order has no linked client record — the name is corrected on this order only."}
        </div>
      </div>

      <div className="mb-2 text-sm font-bold text-at-navy">Commercial &amp; Financial Data</div>
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
            Total Contract Amount ({CURRENCY})
          </label>
          <input
            type="number"
            step={50}
            value={totalAmt}
            onChange={(e) => setTotalAmt(Number(e.target.value))}
            className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
          />
        </div>
        <div>
          <label className="mb-1 block text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
            Deposit Received ({CURRENCY})
          </label>
          <input
            type="number"
            step={50}
            value={depositAmt}
            onChange={(e) => setDepositAmt(Number(e.target.value))}
            className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
          />
        </div>
      </div>

      <div className="mb-2 text-sm font-bold text-at-navy">Job Specifications</div>
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
            Target Print Quantity
          </label>
          <input
            type="number"
            step={100}
            value={qty}
            onChange={(e) => setQty(Number(e.target.value))}
            className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
          />
        </div>
        <div>
          <label className="mb-1 block text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
            {garment ? "Print Type" : "Category of Print"}
          </label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full rounded-at border border-at-border bg-at-white px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
          >
            {categoryOptions.map((c) => (
              <option key={c} value={c}>
                {c || "(none)"}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <div className="mb-3 text-sm font-semibold text-red-600">{error}</div>}
      {success && <div className="mb-3 text-sm font-semibold text-emerald-600">{success}</div>}

      <Button disabled={isPending} onClick={handleSave}>
        Save Changes
      </Button>
    </div>
  );
}

function DeleteMasterOrderSection({ order }: { order: ArchiveOrderRow }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const orderNo = order.job_order_no ?? "";
  const canDelete = confirmText.length > 0 && confirmText === orderNo;

  function handleDelete() {
    if (!canDelete) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteMasterOrder(order.id, confirmText);
      if (result.error) {
        setError(result.error);
        return;
      }
      setShowModal(false);
      setConfirmText("");
    });
  }

  return (
    <div className="mt-4 border-t border-at-border pt-4">
      <Button variant="danger" onClick={() => setShowModal(true)}>
        Delete Master Order
      </Button>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-at-lg bg-at-white p-6 shadow-at-md">
            <div className="mb-2 text-base font-bold text-red-700">Delete Master Order — Permanent</div>
            <div className="mb-4 text-sm text-at-slate">
              This confirmation step is a deliberate safeguard added on top of the original app,
              which deletes with no confirmation at all. This permanently and irreversibly
              deletes order <strong className="text-at-navy">{orderNo}</strong> from the
              database — there is no undo and no soft-delete. Type the order number exactly to
              confirm.
            </div>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={orderNo}
              className="mb-3 w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
            />
            {error && <div className="mb-3 text-sm font-semibold text-red-600">{error}</div>}
            <div className="flex justify-end gap-3">
              <Button
                variant="secondary"
                onClick={() => {
                  setShowModal(false);
                  setConfirmText("");
                  setError(null);
                }}
              >
                Cancel
              </Button>
              <Button variant="danger" disabled={!canDelete || isPending} onClick={handleDelete}>
                Delete Permanently
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ReopenOrderSection({ order }: { order: ArchiveOrderRow }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function handleReopen() {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await reopenOrder(order.id);
      if (result.error) {
        setError(result.error);
      } else {
        setSuccess(`${order.job_order_no} reopened — back to At Warehouse.`);
      }
    });
  }

  return (
    <div className="mt-4 border-t border-at-border pt-4">
      <div className="mb-3 rounded-lg border border-blue-200 border-l-4 border-l-blue-500 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        Finalized by mistake? Reopening reverts the order to <strong>At Warehouse</strong> so
        Dispatch can be redone correctly. Any payment already recorded is untouched — only the
        status reverts.
      </div>
      {error && <div className="mb-3 text-sm font-semibold text-red-600">{error}</div>}
      {success && <div className="mb-3 text-sm font-semibold text-emerald-600">{success}</div>}
      <Button disabled={isPending} onClick={handleReopen}>
        ↩ Reopen Order (undo Finalize Dispatch)
      </Button>
    </div>
  );
}
