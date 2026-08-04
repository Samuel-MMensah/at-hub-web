"use client";

import { useState } from "react";
import { DispatchClient, type DispatchOrderRow } from "./dispatch-client";
import {
  RevenueAnalysisClient,
  type InvoiceRow as RevenueInvoiceRow,
} from "@/app/revenue-analysis/revenue-analysis-client";
import {
  InvoiceEntryClient,
  type JobOrderOption,
  type InvoiceRow,
  type ClientOption,
} from "@/app/revenue-analysis/invoice-entry/invoice-entry-client";
import type { SalesRepOption } from "@/lib/sales-reps";

type TabKey = "dispatch" | "revenue-analysis" | "invoice-entry";

const TABS: { key: TabKey; label: string }[] = [
  { key: "dispatch", label: "Dispatch" },
  { key: "revenue-analysis", label: "Revenue Analysis" },
  { key: "invoice-entry", label: "Invoice Entry" },
];

interface DispatchTabsProps {
  orders: DispatchOrderRow[];
  revenueInvoices: RevenueInvoiceRow[];
  jobOrders: JobOrderOption[];
  invoices: InvoiceRow[];
  clients: ClientOption[];
  salesReps: SalesRepOption[];
}

// Single tab shell for all three — same architecture as
// warehouse-tabs.tsx (Phase 5 of the materials arc): the role gate
// already happened once, at the page level (see page.tsx), before any
// of this ever renders. A user who fails that gate sees one
// RestrictedAccess message and none of this component's tabs or data
// exist, rather than passing a partial-access state down into three
// separately-gated pieces.
//
// "Invoice Entry" bundles Payment Recording (Phase 3.5) automatically
// — that capability was already built as a second section on
// InvoiceEntryClient itself, not a separate route, so reusing that
// component as-is here brings it along without needing a 4th tab.
//
// Simpler than warehouse-tabs.tsx needed to be: Dispatch already had
// its own self-contained Client Component (DispatchClient) doing its
// own month-grouping internally, unlike pre-Phase-5 Warehouse (whose
// Receiving content was inline JSX in the Server Component and had to
// be extracted into a new ReceivingTab function here). Reused as-is,
// nothing relocated or rebuilt.
export function DispatchTabs({ orders, revenueInvoices, jobOrders, invoices, clients, salesReps }: DispatchTabsProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("dispatch");

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

      {activeTab === "dispatch" &&
        (orders.length === 0 ? (
          <div className="rounded-at-lg border border-at-border bg-at-white p-6 text-sm text-at-slate shadow-at-sm">
            No orders currently in production or awaiting collection.
          </div>
        ) : (
          <DispatchClient orders={orders} />
        ))}
      {activeTab === "revenue-analysis" && <RevenueAnalysisClient invoices={revenueInvoices} />}
      {activeTab === "invoice-entry" && (
        <InvoiceEntryClient jobOrders={jobOrders} invoices={invoices} clients={clients} salesReps={salesReps} />
      )}
    </div>
  );
}
