"use client";

import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { PdfPreviewButton } from "@/components/ui/pdf-preview-button";
import { isGarment, type GarmentClassifiable } from "@/lib/is-garment";
import { recordPayment } from "./actions";

const CURRENCY = "GH₵";

export interface ArchiveOrderRow extends GarmentClassifiable {
  id: number;
  job_order_no: string | null;
  customer_name: string;
  status: string | null;
  total_amount: number | null;
  deposit_amount: number | null;
  date_of_collection: string | null;
  approved_by: string | null;
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
                        {order.job_order_no || "—"}
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
    const newDeposit = deposit + payAmt;
    startTransition(async () => {
      const result = await recordPayment(order.id, newDeposit, receiptNo);
      if (result.error) {
        setError(result.error);
      } else {
        setSuccess(`Payment of ${money(payAmt)} recorded. New deposit total: ${money(newDeposit)}`);
      }
    });
  }

  return (
    <div className="mt-4 rounded-at-lg border border-at-border bg-at-white p-6 shadow-at-sm">
      <div className="mb-4 text-sm font-bold text-at-navy">
        Order Operations: {order.job_order_no}
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

      <div className="mt-4 rounded-at border border-dashed border-at-border bg-at-bg px-4 py-3.5 text-xs text-at-slate">
        Master Order Revision and Delete Master Order are not available yet — pending product
        decisions on the edit form&apos;s re-routing behavior and a safer delete-confirmation
        flow.
      </div>
    </div>
  );
}
