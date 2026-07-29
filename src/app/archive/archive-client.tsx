"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { isGarment, type GarmentClassifiable } from "@/lib/is-garment";

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
    </div>
  );
}
