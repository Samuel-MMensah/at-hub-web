"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { CollapsibleMonthGroup } from "@/components/ui/collapsible-month-group";
import { parseTimestamptz } from "@/lib/parse-timestamptz";
import { GanttChart, type GanttRow } from "./gantt-chart";
import { updateStageStatus } from "./actions";

const CURRENCY = "GH₵";

// Duplicated from actions.ts rather than imported: a "use server" file
// may only export async functions, so this small, stable list has to
// live independently on the client side too.
const STAGE_STATUS_OPTIONS = ["In Progress", "Delayed", "On Hold", "Complete"] as const;
type StageStatus = (typeof STAGE_STATUS_OPTIONS)[number];

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
  return `${CURRENCY}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

// Local (system/browser) today's date as "YYYY-MM-DD" — matches Python's
// datetime.now().date(), which is naive local time, not UTC. Wrapped by
// callers in a useState lazy initializer, never called directly during
// render (same reason GanttChart's `now` uses one — see its comment).
function todayLocalDateStr(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Matches datetime.combine(date, datetime.now().time()).replace(tzinfo=timezone.utc)
// exactly: the picked date's Y/M/D combined with the operator's LOCAL
// wall-clock time-of-day, then labeled UTC WITHOUT converting — this is
// not "now converted to UTC", it's the source's own quirk (a naive local
// time relabeled as if it were UTC), ported faithfully rather than fixed.
// Only ever called from an event handler, never during render, so the
// impure `new Date()` call here doesn't trip the purity lint rule.
function combineDateWithNowAsUtc(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const now = new Date();
  return new Date(Date.UTC(y, m - 1, d, now.getHours(), now.getMinutes(), now.getSeconds())).toISOString();
}

interface ShopFloorClientProps {
  pipeline: PipelineRow[];
  jobs: FloorJobRow[];
}

export function ShopFloorClient({ pipeline, jobs }: ShopFloorClientProps) {
  const [showCompleted, setShowCompleted] = useState(false);
  const [rawSelectedOrder, setRawSelectedOrder] = useState<string | null>(null);
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

  // Stage picker for Operator Update — scoped to the same jobs subset as
  // drilldownRows (the currently drilled-down order), not a global picker
  // across the whole shop. Sorted by sequence_no for consistency with the
  // drill-down Gantt above it (the source's own floor_df ordering here is
  // incidental/unsorted at this point — see actions.ts's port notes).
  const stageOptions = useMemo(() => {
    if (!selectedOrder) return [];
    const seen = new Set<string>();
    const opts: { value: string; label: string }[] = [];
    for (const j of jobs
      .filter((j) => j.job_order_no === selectedOrder)
      .slice()
      .sort((a, b) => (a.sequence_no ?? 0) - (b.sequence_no ?? 0))) {
      if (!j.tracking_id || seen.has(j.tracking_id)) continue;
      seen.add(j.tracking_id);
      opts.push({ value: j.tracking_id, label: j.machine });
    }
    return opts;
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

          <OperatorUpdatePanel stageOptions={stageOptions} />
        </div>
      )}

      <CollapsibleMonthGroup
        monthLabel="Machine Utilisation — whole shop"
        itemCount={machineRows.length}
        itemLabel="jobs"
        defaultExpanded={false}
      >
        {machineRows.length === 0 ? (
          <div className="text-sm text-at-slate">Nothing scheduled.</div>
        ) : (
          <GanttChart
            rows={machineRows}
            colorMap={RUN_STATUS_COLORS}
            nowLineColor="#ef4444"
            legendTitle="Run Status"
            emptyMessage="Nothing scheduled."
          />
        )}
      </CollapsibleMonthGroup>
    </div>
  );
}

// Ports the "Operator Update" expander (app.py:5593-5611) — collapsed by
// default, matching the source and this file's own Machine Utilisation
// section's expand/collapse convention. stageOptions is already scoped
// to the currently drilled-down order by the caller.
function OperatorUpdatePanel({ stageOptions }: { stageOptions: { value: string; label: string }[] }) {
  const [rawTrackingId, setRawTrackingId] = useState<string | null>(null);
  const [status, setStatus] = useState<StageStatus>("In Progress");
  // Lazy initializer — same purity reasoning as GanttChart's `now`.
  const [dateStr, setDateStr] = useState(() => todayLocalDateStr());
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Deliberate improvement over the source, not a faithful port (same
  // category as Archive's delete-confirmation gate): closes the
  // double-submit compounding gap found in live cascade testing.
  // `isPending`'s disabled attribute lags the click by a render cycle —
  // a fast enough double-click can fire both handler calls before React
  // commits that update, since update_stage_status's sibling baseline
  // (revised_finish ?? planned_finish) compounds on a second call. A
  // plain ref check+set is synchronous with no render in between, so it
  // has no such window — `isPending` still drives the visible disabled
  // state (same convention as every other write button in this app),
  // this ref is what actually enforces it.
  const submittingRef = useRef(false);

  // Falls back to the first option if the previous selection is no
  // longer valid (e.g. the drilled-down order changed) — same pattern as
  // ShopFloorClient's own selectedOrder fallback.
  const trackingId =
    rawTrackingId && stageOptions.some((o) => o.value === rawTrackingId)
      ? rawTrackingId
      : (stageOptions[0]?.value ?? null);

  const needsDate = status === "Delayed" || status === "Complete";

  function handleSubmit() {
    if (submittingRef.current) return;
    if (!trackingId) return;
    submittingRef.current = true;
    setError(null);
    setSuccess(null);
    // In Progress / On Hold: no date, no cascade — revisedFinishIso stays
    // null, matching the source's _eta_dt staying None for these two.
    const revisedFinishIso = needsDate ? combineDateWithNowAsUtc(dateStr) : null;
    startTransition(async () => {
      try {
        const result = await updateStageStatus(trackingId, status, revisedFinishIso);
        if (result.error) {
          setError(result.error);
        } else {
          setSuccess("Updated — downstream stages recalculated if this pushed the schedule.");
        }
      } finally {
        submittingRef.current = false;
      }
    });
  }

  if (stageOptions.length === 0) return null;

  return (
    <div className="mt-3">
      <CollapsibleMonthGroup monthLabel="Operator Update" defaultExpanded={false}>
          <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
                Stage
              </label>
              <select
                value={trackingId ?? ""}
                onChange={(e) => setRawTrackingId(e.target.value)}
                className="w-full rounded-at border border-at-border bg-at-white px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
              >
                {stageOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
                Status
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as StageStatus)}
                className="w-full rounded-at border border-at-border bg-at-white px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
              >
                {STAGE_STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {needsDate && (
            <div className="mb-3 max-w-xs">
              <label className="mb-1 block text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
                {status === "Delayed" ? "New finish date" : "Actual finish date"}
              </label>
              <input
                type="date"
                value={dateStr}
                onChange={(e) => setDateStr(e.target.value)}
                className="w-full max-w-xs rounded-at border border-at-border bg-at-white px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
              />
            </div>
          )}

          {error && <div className="mb-3 text-sm font-semibold text-red-600">{error}</div>}
          {success && <div className="mb-3 text-sm font-semibold text-emerald-600">{success}</div>}

          <Button disabled={isPending || !trackingId} onClick={handleSubmit}>
            Update Stage Status
          </Button>
      </CollapsibleMonthGroup>
    </div>
  );
}
