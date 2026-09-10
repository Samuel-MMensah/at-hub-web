"use client";

import { Building2, Phone, Mail, FileText, Shirt } from "lucide-react";
import { PdfPreviewButton } from "@/components/ui/pdf-preview-button";
import { CollapsibleMonthGroup } from "@/components/ui/collapsible-month-group";
import { currentMonthKey, groupByMonth, type MonthGroup } from "@/lib/month-groups";
import { isGarment, type GarmentClassifiable } from "@/lib/is-garment";

const CURRENCY = "GH₵";

export interface ClientOrderRow extends GarmentClassifiable {
  id: number;
  job_order_no: string | null;
  status: string | null;
  total_amount: number | null;
  deposit_amount: number | null;
  // Plain DATE column ("2026-08-24"), confirmed populated on every real
  // row (252/252, live-checked) — used for both the Date column and
  // month-grouping. Deliberately not created_at: this is a cleaner,
  // time-of-day-free date for a historical record, and just as reliable.
  order_date: string | null;
}

interface ClientInfo {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
}

function money(n: number): string {
  return `${CURRENCY}${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}

const STATUS_COLORS: Record<string, string> = {
  Approved: "#10b981",
  "In Production": "#0369a1",
  "At Warehouse": "#4f46e5",
  "Ready for Collection": "#7c3aed",
  Delivered: "#059669",
};

export function ClientProfileClient({ client, orders }: { client: ClientInfo; orders: ClientOrderRow[] }) {
  const withDate = orders.filter((o) => o.order_date);
  const withoutDate = orders.filter((o) => !o.order_date);
  const monthGroups: MonthGroup<ClientOrderRow>[] = groupByMonth(
    withDate,
    (o) => new Date(o.order_date as string)
  );
  if (withoutDate.length > 0) {
    monthGroups.push({ key: "", label: "Unknown Date", items: withoutDate });
  }
  const currentKey = currentMonthKey();

  const totalValue = orders.reduce((sum, o) => sum + Number(o.total_amount ?? 0), 0);

  return (
    <div>
      <div className="mb-6 rounded-at-lg border border-at-border bg-at-white p-6 shadow-at-sm">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-at-bg text-at-navy">
            <Building2 size={20} />
          </div>
          <div className="min-w-0">
            <div className="text-xl font-extrabold text-at-navy">{client.name}</div>
            <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-sm text-at-slate">
              <span className="inline-flex items-center gap-1.5">
                <Phone size={14} /> {client.phone || "—"}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Mail size={14} /> {client.email || "—"}
              </span>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-6 border-t border-at-border pt-4">
          <div>
            <div className="text-[0.65rem] font-bold uppercase tracking-wide text-at-slate-light">
              Confirmed Orders
            </div>
            <div className="text-lg font-extrabold text-at-navy">{orders.length}</div>
          </div>
          <div>
            <div className="text-[0.65rem] font-bold uppercase tracking-wide text-at-slate-light">
              Total Confirmed Value
            </div>
            <div className="text-lg font-extrabold text-at-navy">{money(totalValue)}</div>
          </div>
        </div>
      </div>

      <div className="mb-3 text-sm font-bold text-at-navy-soft">
        Order History — Approved and Beyond
      </div>

      {orders.length === 0 ? (
        <div className="rounded-at-lg border border-at-border bg-at-white p-6 text-sm text-at-slate shadow-at-sm">
          No approved orders yet for this client. Orders still pending authorization, awaiting
          revision approval, or rejected aren&apos;t shown here — this is a record of confirmed
          business only.
        </div>
      ) : (
        monthGroups.map((month) => (
          <CollapsibleMonthGroup
            key={month.key}
            monthLabel={month.label}
            itemCount={month.items.length}
            defaultExpanded={month.key === currentKey}
          >
            <div className="-mx-4 -my-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-at-border bg-at-bg">
                    {["Order No", "Date", "Status", "Category", `Total (${CURRENCY})`, `Balance (${CURRENCY})`, ""].map(
                      (col) => (
                        <th
                          key={col}
                          className="whitespace-nowrap px-4 py-2.5 text-[0.7rem] font-bold uppercase tracking-wide text-at-slate"
                        >
                          {col}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody>
                  {month.items.map((order) => {
                    const total = Number(order.total_amount ?? 0);
                    const deposit = Number(order.deposit_amount ?? 0);
                    const balance = total - deposit; // not clamped — matches Archive/Audit Log's own balance convention
                    const garment = isGarment(order);
                    const statusColor = STATUS_COLORS[order.status ?? ""] ?? "#64748b";

                    return (
                      <tr key={order.id} className="border-b border-at-border last:border-0 hover:bg-at-bg">
                        <td className="whitespace-nowrap px-4 py-2.5 font-semibold text-at-navy">
                          {order.job_order_no || "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-at-navy">
                          {order.order_date || "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 font-semibold" style={{ color: statusColor }}>
                          {order.status || "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-at-navy">
                          {garment ? "GARMENT" : "PRESS"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-at-navy">{money(total)}</td>
                        <td
                          className="whitespace-nowrap px-4 py-2.5 font-semibold"
                          style={{ color: balance > 0 ? "#ef4444" : "#10b981" }}
                        >
                          {money(balance)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5">
                          <PdfPreviewButton
                            orderId={order.id}
                            label={
                              garment ? (
                                <>
                                  <Shirt size={13} /> Preview PDF
                                </>
                              ) : (
                                <>
                                  <FileText size={13} /> Preview PDF
                                </>
                              )
                            }
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CollapsibleMonthGroup>
        ))
      )}
    </div>
  );
}
