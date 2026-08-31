"use client";

import { useMemo, useState, useTransition } from "react";
import { Shirt, FileText } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { PdfPreviewButton } from "@/components/ui/pdf-preview-button";
import { isGarment, type GarmentClassifiable } from "@/lib/is-garment";
import { startProduction, sendToWarehouse } from "./actions";

const CURRENCY = "GH₵";
const DEPT_OPTIONS = ["All Departments", "PRESS", "GARMENT"] as const;
type DeptChoice = (typeof DEPT_OPTIONS)[number];
type Dept = "PRESS" | "GARMENT";

export interface ProductionOrderRow extends GarmentClassifiable {
  id: number;
  job_order_no: string | null;
  customer_name: string;
  job_description: string | null;
  status: string | null;
  total_amount: number | null;
  qty_to_print: number;
  is_sample: boolean;
  sample_reason: string | null;
}

function money(n: number): string {
  return `${CURRENCY}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function statusTone(status: string): "success" | "warning" | "danger" | "idle" | "accent" {
  if (status === "Approved") return "success";
  if (status === "In Production") return "accent";
  return "idle";
}

interface ProductionBoardClientProps {
  orders: ProductionOrderRow[];
  // Locked to the floor worker's own department (profiles.department is
  // exactly PRESS or GARMENT); null means free choice — matches
  // production.py's user_department gating: floor staff assigned to one
  // department are locked, everyone else (including Front Desk/MD/FM)
  // gets the full radio.
  lockedDept: Dept | null;
}

export function ProductionBoardClient({ orders, lockedDept }: ProductionBoardClientProps) {
  const [deptChoice, setDeptChoice] = useState<DeptChoice>(lockedDept ?? "All Departments");

  const ordersWithDept = useMemo(
    () =>
      orders.map((order) => ({
        ...order,
        _dept: (isGarment(order) ? "GARMENT" : "PRESS") as Dept,
      })),
    [orders]
  );

  const filtered = useMemo(() => {
    if (deptChoice === "All Departments") return ordersWithDept;
    return ordersWithDept.filter((order) => order._dept === deptChoice);
  }, [ordersWithDept, deptChoice]);

  return (
    <div>
      {!lockedDept && (
        <div className="mb-4 flex gap-2">
          {DEPT_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setDeptChoice(option)}
              className={`rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors ${
                deptChoice === option
                  ? "border-at-navy bg-at-navy text-at-white"
                  : "border-at-border bg-at-white text-at-slate hover:border-at-accent"
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="rounded-at-lg border border-at-border bg-at-white p-6 text-sm text-at-slate shadow-at-sm">
          No approved {deptChoice === "All Departments" ? "" : `${deptChoice.toLowerCase()} `}
          orders waiting.
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {filtered.map((order) => (
            <ProductionOrderCard key={order.id} order={order} />
          ))}
        </div>
      )}
    </div>
  );
}

function ProductionOrderCard({ order }: { order: ProductionOrderRow & { _dept: Dept } }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const orderNo = order.job_order_no || "—";
  const status = (order.status || "—").trim();
  const total = Number(order.total_amount ?? 0);

  function handleStartProduction() {
    setError(null);
    startTransition(async () => {
      const result = await startProduction(order.id);
      if (result.error) setError(result.error);
    });
  }

  function handleSendToWarehouse() {
    setError(null);
    startTransition(async () => {
      const result = await sendToWarehouse(order.id);
      if (result.error) setError(result.error);
    });
  }

  return (
    <div className="rounded-at-lg border border-at-border bg-at-white p-6 shadow-at-sm">
      <div className="mb-1 flex items-center gap-2 text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
        <span>{orderNo}</span>
        <span>·</span>
        <span>{order._dept}</span>
        <StatusBadge label={status} tone={statusTone(status)} />
        {order.is_sample && (
          <StatusBadge label="SAMPLE" tone="sample" title={order.sample_reason ?? undefined} />
        )}
      </div>
      <div className="mb-1 text-[1.3rem] font-extrabold text-at-navy">
        {order.customer_name || "—"}
      </div>
      <div className="mb-4 text-sm text-slate-600">{order.job_description || "—"}</div>

      <div className="mb-4 flex gap-4">
        <div className="rounded-lg bg-at-bg px-4 py-2">
          <div className="text-[0.65rem] uppercase tracking-wide text-at-slate">Contract</div>
          <div className="font-bold text-at-navy">{money(total)}</div>
        </div>
        <div className="rounded-lg bg-at-bg px-4 py-2">
          <div className="text-[0.65rem] uppercase tracking-wide text-at-slate">Qty</div>
          <div className="font-bold text-at-navy">{order.qty_to_print ?? "—"}</div>
        </div>
      </div>

      {error && <div className="mb-3 text-sm font-semibold text-red-600">{error}</div>}

      <div className="flex justify-end gap-3">
        {status === "Approved" && (
          <Button disabled={isPending} onClick={handleStartProduction}>
            Start Production
          </Button>
        )}
        {status === "In Production" && (
          <Button disabled={isPending} onClick={handleSendToWarehouse}>
            Send to Warehouse
          </Button>
        )}
        <PdfPreviewButton
          orderId={order.id}
          label={
            order._dept === "GARMENT" ? (
              <>
                <Shirt size={14} /> Preview Garment PDF
              </>
            ) : (
              <>
                <FileText size={14} /> Preview PDF
              </>
            )
          }
        />
      </div>
    </div>
  );
}
