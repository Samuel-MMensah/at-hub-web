"use client";

import { useState } from "react";
import { PdfPreviewButton } from "@/components/ui/pdf-preview-button";
import { CollapsibleMonthGroup } from "@/components/ui/collapsible-month-group";
import { isGarment, type GarmentClassifiable } from "@/lib/is-garment";
import type { MonthGroup } from "@/lib/month-groups";
import { NotifyFinanceButton } from "./notify-finance-button";
import { StockBalanceClient, type StockBalanceRow } from "@/app/warehouse-inventory/stock-balance/stock-balance-client";
import {
  MaterialReceiptsClient,
  type MaterialOption,
  type ReceiptRow,
} from "@/app/warehouse-inventory/material-receipts/material-receipts-client";
import {
  MaterialIssuancesClient,
  type JobOrderOption,
  type IssuanceRow,
} from "@/app/warehouse-inventory/material-issuances/material-issuances-client";

export interface WarehouseOrderRow extends GarmentClassifiable {
  id: number;
  job_order_no: string | null;
  customer_name: string;
  qty_to_print: number;
  warehouse_notified_finance: boolean | null;
  created_at: string | null;
}

type TabKey = "receiving" | "stock-balance" | "material-receipts" | "material-issuance";

const TABS: { key: TabKey; label: string }[] = [
  { key: "receiving", label: "Receiving" },
  { key: "stock-balance", label: "Stock Balance" },
  { key: "material-receipts", label: "Material Receipts" },
  { key: "material-issuance", label: "Material Issuance" },
];

interface WarehouseTabsProps {
  monthGroups: MonthGroup<WarehouseOrderRow>[];
  currentKey: string;
  stockBalance: StockBalanceRow[];
  materials: MaterialOption[];
  receipts: ReceiptRow[];
  jobOrders: JobOrderOption[];
  issuances: IssuanceRow[];
}

// Single tab shell for all four — the role gate already happened once,
// at the page level (see page.tsx), before any of this ever renders.
// A user who fails that gate sees one RestrictedAccess message and
// none of this component's tabs or data exist, rather than passing a
// partial-access state down into four separately-gated pieces.
export function WarehouseTabs({
  monthGroups,
  currentKey,
  stockBalance,
  materials,
  receipts,
  jobOrders,
  issuances,
}: WarehouseTabsProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("receiving");

  return (
    <div>
      <div className="mb-4 flex gap-1 border-b border-at-border">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2.5 text-sm font-bold transition-colors ${
              activeTab === tab.key
                ? "border-b-2 border-at-navy text-at-navy"
                : "text-at-slate hover:text-at-navy"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "receiving" && <ReceivingTab monthGroups={monthGroups} currentKey={currentKey} />}
      {activeTab === "stock-balance" && <StockBalanceClient rows={stockBalance} />}
      {activeTab === "material-receipts" && (
        <MaterialReceiptsClient materials={materials} receipts={receipts} />
      )}
      {activeTab === "material-issuance" && (
        <MaterialIssuancesClient materials={materials} jobOrders={jobOrders} issuances={issuances} />
      )}
    </div>
  );
}

// Ported verbatim from the pre-Phase-5 warehouse/page.tsx — same
// month-grouping, same card layout, same NotifyFinanceButton /
// PdfPreviewButton actions. No functional change, just relocated from
// the Server Component's JSX into this tab.
function ReceivingTab({
  monthGroups,
  currentKey,
}: {
  monthGroups: MonthGroup<WarehouseOrderRow>[];
  currentKey: string;
}) {
  const totalOrders = monthGroups.reduce((sum, m) => sum + m.items.length, 0);

  if (totalOrders === 0) {
    return (
      <div className="rounded-at-lg border border-at-border bg-at-white p-6 text-sm text-at-slate shadow-at-sm">
        Nothing waiting at the warehouse right now.
      </div>
    );
  }

  return (
    <div>
      {monthGroups.map((month) => (
        <CollapsibleMonthGroup
          key={month.key}
          monthLabel={month.label}
          itemCount={month.items.length}
          defaultExpanded={month.key === currentKey}
        >
          <div className="flex flex-col gap-4">
            {month.items.map((order) => {
              const orderNo = order.job_order_no || "—";
              const alreadyNotified = Boolean(order.warehouse_notified_finance);
              const garment = isGarment(order);

              return (
                <div
                  key={order.id}
                  className="rounded-at-lg border border-at-border bg-at-white p-6 shadow-at-sm"
                >
                  <div className="mb-0.5 text-[0.65rem] font-bold uppercase tracking-wide text-at-slate">
                    {orderNo} · At Warehouse
                  </div>
                  <div className="text-[1.15rem] font-extrabold text-at-navy">
                    {order.customer_name || "—"}
                  </div>
                  <div className="mt-1 text-sm text-at-slate">
                    Quantity: {order.qty_to_print ?? "—"}
                  </div>

                  <div className="mt-4 flex items-center justify-end gap-3">
                    <NotifyFinanceButton orderId={order.id} initiallyNotified={alreadyNotified} />
                    <PdfPreviewButton
                      orderId={order.id}
                      label={garment ? "🧵 Preview Garment PDF" : "📄 Preview PDF"}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </CollapsibleMonthGroup>
      ))}
    </div>
  );
}
