"use client";

import { useMemo, useState } from "react";
import { parseTimestamptz } from "@/lib/parse-timestamptz";
import { GanttChart, type GanttRow } from "./gantt-chart";

const CURRENCY = "GH₵";

export interface PipelineRow {
  job_order_no: string;
  customer_name: string | null;
  stage_count: number;
  stages_complete: number;
  scheduled_start: string | null;
  projected_completion: string | null;
  current_stage: string | null;
  next_stage: string | null;
  health: string | null;
}

export interface FloorJobRow {
  tracking_id: string | null;
  job_order_no: string | null;
  job_name: string;
  machine: string;
  sequence_no: number | null;
  stage_status: string | null;
  start_time: string;
  finish_time: string;
  revised_finish: string | null;
  quantity: number;
  contract_value: number | null;
  customer_name: string | null;
}

const HEALTH_COLORS: Record<string, string> = {
  "On Track": "#10b981",
  "At Risk": "#f59e0b",
  Late: "#ef4444",
};

const STAGE_STATUS_COLORS: Record<string, string> = {
  Scheduled: "#94a3b8",
  "In Progress": "#0369a1",
  Delayed: "#ef4444",
  Complete: "#10b981",
  "On Hold": "#f59e0b",
};

const RUN_STATUS_COLORS: Record<string, string> = {
  Active: "#0369a1",
  Queued: "#f59e0b",
  Completed: "#94a3b8",
};

function money(n: number): string {
  return `${CURRENCY} ${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}

function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDateOnly(ms: number): string {
  return new Date(ms).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

// revised_finish if set and parseable, else finish_time — matches
// get_shop_floor_timeline()'s effective_finish exactly.
function effectiveFinish(job: FloorJobRow): Date {
  if (job.revised_finish) {
    const revised = parseTimestamptz(job.revised_finish);
    if (!Number.isNaN(revised.getTime())) return revised;
  }
  return parseTimestamptz(job.finish_time);
}

interface ShopFloorClientProps {
  pipeline: PipelineRow[];
  jobs: FloorJobRow[];
}

export function ShopFloorClient({ pipeline, jobs }: ShopFloorClientProps) {
  const [showCompleted, setShowCompleted] = useState(false);
  const [rawSelectedOrder, setRawSelectedOrder] = useState<string | null>(null);
  const [machineExpanded, setMachineExpanded] = useState(false);
  // Lazy initializer: computed once on mount, not on every render — see
  // gantt-chart.tsx for why Date.now() can't be called directly during render.
  const [now] = useState(() => Date.now());

  const pipelineRows: GanttRow[] = useMemo(() => {
    const filtered = showCompleted ? pipeline : pipeline.filter((r) => r.stages_complete < r.stage_count);
    return filtered
      .filter((r) => r.scheduled_start && r.projected_completion)
      .map((r) => {
        const start = parseTimestamptz(r.scheduled_start as string).getTime();
        const end = parseTimestamptz(r.projected_completion as string).getTime();
        return {
          id: r.job_order_no,
          label: r.customer_name ? `${r.job_order_no} — ${r.customer_name}` : r.job_order_no,
          start,
          end,
          colorKey: r.health ?? "On Track",
          tooltipLines: [
            `Currently: ${r.current_stage ?? "—"}`,
            `Next: ${r.next_stage ?? "Final stage"}`,
            `${r.stages_complete}/${r.stage_count} stages complete`,
            `Est. completion ${formatDateOnly(end)}`,
          ],
        };
      })
      .sort((a, b) => a.start - b.start);
  }, [pipeline, showCompleted]);

  const orderOptions = useMemo(
    () =>
      pipelineRows
        .slice()
        .sort((a, b) => a.label.localeCompare(b.label))
        .map((r) => ({ value: r.id, label: r.label })),
    [pipelineRows]
  );

  // Falls back to the first available option if the previous selection
  // is no longer in the (possibly re-filtered) list — matches Streamlit
  // selectbox's own behavior when its options change under it.
  const selectedOrder =
    rawSelectedOrder && orderOptions.some((o) => o.value === rawSelectedOrder)
      ? rawSelectedOrder
      : (orderOptions[0]?.value ?? null);

  const drilldownRows: GanttRow[] = useMemo(() => {
    if (!selectedOrder) return [];
    return jobs
      .filter((j) => j.job_order_no === selectedOrder)
      .slice()
      .sort((a, b) => (a.sequence_no ?? 0) - (b.sequence_no ?? 0))
      .map((j) => {
        const start = parseTimestamptz(j.start_time).getTime();
        const end = effectiveFinish(j).getTime();
        return {
          id: j.tracking_id ?? `${j.machine}-${j.start_time}`,
          label: j.machine,
          start,
          end,
          colorKey: j.stage_status ?? "Scheduled",
          tooltipLines: [
            j.stage_status ?? "Scheduled",
            `${formatDateTime(start)} → ${formatDateTime(end)}`,
            `Qty: ${j.quantity.toLocaleString()}`,
            `Value: ${j.contract_value != null ? money(j.contract_value) : "—"}`,
          ],
        };
      });
  }, [jobs, selectedOrder]);

  const machineRows: GanttRow[] = useMemo(() => {
    return jobs
      .slice()
      .sort((a, b) => parseTimestamptz(a.start_time).getTime() - parseTimestamptz(b.start_time).getTime())
      .map((j) => {
        const start = parseTimestamptz(j.start_time).getTime();
        const end = effectiveFinish(j).getTime();
        const runStatus = end < now ? "Completed" : start <= now && now <= end ? "Active" : "Queued";
        const clientLabel = j.customer_name
          ? `${j.job_order_no} — ${j.customer_name}`
          : `${j.job_name} (legacy)`;
        return {
          id: j.tracking_id ?? `${j.machine}-${j.start_time}`,
          label: j.machine,
          start,
          end,
          colorKey: runStatus,
          tooltipLines: [clientLabel, `Qty: ${j.quantity.toLocaleString()}`],
        };
      });
  }, [jobs, now]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="mb-2 text-sm font-bold text-at-navy">Production Pipeline — every order in flight</div>
        <label className="mb-3 flex items-center gap-2 text-sm text-at-slate">
          <input
            type="checkbox"
            checked={showCompleted}
            onChange={(e) => setShowCompleted(e.target.checked)}
          />
          Show completed orders too
        </label>
        <GanttChart
          rows={pipelineRows}
          colorMap={HEALTH_COLORS}
          nowLineColor="#0f172a"
          legendTitle="Health"
          emptyMessage="No orders currently in production. Use the Production Layout Builder to schedule an approved order."
        />
      </div>

      {orderOptions.length > 0 && (
        <div>
          <div className="mb-2 text-sm font-bold text-at-navy">Drill Down — stage-by-stage detail for one order</div>
          <select
            value={selectedOrder ?? ""}
            onChange={(e) => setRawSelectedOrder(e.target.value)}
            className="mb-3 w-full max-w-md rounded-at border border-at-border bg-at-white px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
          >
            {orderOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <GanttChart
            rows={drilldownRows}
            colorMap={STAGE_STATUS_COLORS}
            nowLineColor="#0f172a"
            legendTitle="Stage Status"
            emptyMessage="No stage-level schedule found for this order yet."
          />
        </div>
      )}

      <div>
        <button
          type="button"
          onClick={() => setMachineExpanded((v) => !v)}
          className="mb-2 flex items-center gap-1.5 text-sm font-bold text-at-navy"
        >
          <span className={`transition-transform ${machineExpanded ? "rotate-90" : ""}`}>▸</span>
          Machine Utilisation — whole shop
        </button>
        {machineExpanded &&
          (machineRows.length === 0 ? (
            <div className="rounded-at-lg border border-at-border bg-at-white p-6 text-sm text-at-slate shadow-at-sm">
              Nothing scheduled.
            </div>
          ) : (
            <GanttChart
              rows={machineRows}
              colorMap={RUN_STATUS_COLORS}
              nowLineColor="#ef4444"
              legendTitle="Run Status"
              emptyMessage="Nothing scheduled."
            />
          ))}
      </div>
    </div>
  );
}
