"use client";

import { useMemo, useState, useTransition } from "react";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { CollapsibleMonthGroup } from "@/components/ui/collapsible-month-group";
import { parseTimestamptz } from "@/lib/parse-timestamptz";
import { currentMonthKey, groupByMonth, type MonthGroup } from "@/lib/month-groups";
import { recordPayment, finalizeDispatch } from "./actions";

const CURRENCY = "GH₵";

export interface DispatchOrderRow {
  id: number;
  job_order_no: string | null;
  customer_name: string;
  status: string | null;
  total_amount: number | null;
  deposit_amount: number | null;
  payment_terms: string | null;
  created_at: string | null;
  is_sample: boolean;
  sample_reason: string | null;
}

function money(n: number): string {
  return `${CURRENCY}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Same round2()/comparison-parity fix as recordInvoicePayment (Invoice
// Entry) and recordPayment (this page's own server action) — the
// client-side disable check below compares raw state to a raw balance,
// so it must round the same way the display does or it can block a
// payment before the (already-fixed) server action even sees it.
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function statusTone(status: string): "success" | "warning" | "danger" | "idle" | "accent" {
  if (status === "At Warehouse") return "warning";
  if (status === "In Production") return "accent";
  return "idle";
}

export function DispatchClient({ orders }: { orders: DispatchOrderRow[] }) {
  // Same month-grouping convention as Audit Log / My Order Tracker
  // (src/lib/month-groups.ts) — UTC calendar month, current month
  // expanded by default. No search/filter on this page, so there's no
  // isFiltering-driven force-expand case here, unlike those two.
  const monthGroups = useMemo(() => {
    const withDate = orders.filter((o) => o.created_at);
    const withoutDate = orders.filter((o) => !o.created_at);
    const groups: MonthGroup<DispatchOrderRow>[] = groupByMonth(withDate, (o) =>
      parseTimestamptz(o.created_at as string)
    );
    if (withoutDate.length > 0) {
      groups.push({ key: "", label: "Unknown Date", items: withoutDate });
    }
    return groups;
  }, [orders]);

  const currentKey = currentMonthKey();

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
            {month.items.map((order) => (
              <DispatchOrderCard key={order.id} order={order} />
            ))}
          </div>
        </CollapsibleMonthGroup>
      ))}
    </div>
  );
}

function DispatchOrderCard({ order }: { order: DispatchOrderRow }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const orderNo = order.job_order_no || "—";
  const status = (order.status || "—").trim();
  const total = Number(order.total_amount ?? 0);
  const deposit = Number(order.deposit_amount ?? 0);
  // Clamped, unlike Command Center's unclamped contractValue - depositCollected —
  // these are two different call sites with two different real behaviors.
  const balance = Math.max(0, total - deposit);
  const notReady = status !== "At Warehouse";
  const is30Day = (order.payment_terms || "").includes("30-Day Credit Terms");

  const [payAmt, setPayAmt] = useState(balance);
  const [receiptNo, setReceiptNo] = useState("");
  const [confirm30Day, setConfirm30Day] = useState(false);

  function handleRecordPayment() {
    setError(null);
    startTransition(async () => {
      // recordPayment now takes the INCREMENTAL payment amount only —
      // it re-fetches the real current deposit_amount server-side and
      // computes the new cumulative total itself (fixed: previously
      // this component computed deposit + payAmt and the action wrote
      // that as-is, trusting whatever the client sent).
      const result = await recordPayment(order.id, payAmt, receiptNo);
      if (result.error) setError(result.error);
    });
  }

  function handleFinalize() {
    setError(null);
    startTransition(async () => {
      const result = await finalizeDispatch(order.id);
      if (result.error) setError(result.error);
    });
  }

  return (
    <div className="rounded-at-lg border border-at-border bg-at-white p-6 shadow-at-sm">
      <div className="flex items-start justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <span className="text-[0.65rem] font-bold uppercase tracking-wide text-at-slate">
              {orderNo}
            </span>
            <StatusBadge label={status} tone={statusTone(status)} />
            {order.is_sample && (
              <StatusBadge label="SAMPLE" tone="sample" title={order.sample_reason ?? undefined} />
            )}
          </div>
          <div className="text-[1.15rem] font-extrabold text-at-navy">
            {order.customer_name || "—"}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[0.65rem] uppercase tracking-wide text-at-slate">Balance</div>
          <div
            className="text-[1.1rem] font-extrabold"
            style={{ color: balance > 0 ? "#ef4444" : "#10b981" }}
          >
            {money(balance)}
          </div>
        </div>
      </div>

      {balance > 0 && (
        <>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div>
              <label className="mb-1 block text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
                Payment amount
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
            <Button
              disabled={isPending || payAmt <= 0 || round2(payAmt) > round2(balance)}
              onClick={handleRecordPayment}
            >
              Record Payment
            </Button>
          </div>

          <div className="mt-3 rounded-at border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-800">
            Finalize Dispatch is locked until the outstanding balance of {money(balance)} is
            fully recorded.
          </div>
        </>
      )}

      {balance > 0 && is30Day && (
        <div className="mt-3 rounded-at border border-blue-200 bg-blue-50 px-4 py-2.5">
          <div className="mb-2 text-sm font-semibold text-blue-900">
            This order is flagged 30-Day Credit Terms — payment isn&apos;t expected yet. Confirm
            below to allow dispatch without full payment.
          </div>
          <label className="flex items-center gap-2 text-sm text-blue-900">
            <input
              type="checkbox"
              checked={confirm30Day}
              onChange={(e) => setConfirm30Day(e.target.checked)}
            />
            Confirm this is a 30-day credit terms job — allow dispatch without full payment
          </label>
        </div>
      )}

      {notReady && (
        <div className="mt-3 rounded-at border border-at-warning bg-at-warning-bg px-4 py-2.5 text-sm font-semibold text-at-warning-text">
          Still in production — Finalize Dispatch unlocks once the production team marks this
          order sent to the warehouse.
        </div>
      )}

      {error && <div className="mt-3 text-sm font-semibold text-red-600">{error}</div>}

      <div className="mt-3 flex justify-end">
        <Button disabled={isPending || (balance > 0 && !confirm30Day) || notReady} onClick={handleFinalize}>
          Finalize Dispatch
        </Button>
      </div>
    </div>
  );
}
