"use client";

import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { commitProductionPlan } from "./actions";

const CURRENCY = "GH₵";
const SHIFT_START_HOUR = 8;
const SHIFT_END_HOUR = 17;
const STAGE_DAYS_WARNING_THRESHOLD = 30; // working days (~6 calendar weeks)
const MAX_COMPONENTS = 6;

interface MachineSpec {
  rate: number;
  setupHours: number;
}

// Ports MACHINE_DATA from app.py:142-160 verbatim, including setup_hours
// (unused by Phase 1's pre-flight estimate, but kept here as the single
// source of truth rather than re-transcribing a second, partial copy
// when Phase 2's real scheduler needs it too). Insertion order matters:
// both PRESS_MACHINE_OPTIONS and FINISHING_MACHINE_OPTIONS below derive
// their display order from it, matching the source's own dict order.
const MACHINE_DATA: Record<string, MachineSpec> = {
  "SM102-CX FOUR COLOUR": { rate: 8000, setupHours: 1.5 },
  "SM102-P FIVE COLOUR": { rate: 7500, setupHours: 1.5 },
  "SM 52": { rate: 7000, setupHours: 1.5 },
  "GTO 52 SEMI-AUTO-2 COLOUR": { rate: 4500, setupHours: 1.5 },
  "GTO 52 MANUAL-2 COLOUR": { rate: 4000, setupHours: 2.0 },
  "FOLDING UNIT CONTINUOUS FOLD": { rate: 8000, setupHours: 1.5 },
  "MBO-B30E SINGLE FOLD": { rate: 16000, setupHours: 1.5 },
  "POLAR MACHINE FOR BOOKS": { rate: 2000, setupHours: 1.0 },
  "POLAR MACHINE FOR SHEETS": { rate: 50000, setupHours: 1.0 },
  "3 WAY TRIMMER": { rate: 5000, setupHours: 1.0 },
  "PERFECT BINDING": { rate: 500, setupHours: 1.5 },
  "LAMINATION UNIT": { rate: 2500, setupHours: 1.5 },
  "PEDDLER SADDLE STITCH": { rate: 1000, setupHours: 1.5 },
  "DIE CUTTER": { rate: 3000, setupHours: 1.5 },
  "FOLDER GLUER": { rate: 12000, setupHours: 1.5 },
  "CANON DIGITAL C10000": { rate: 6000, setupHours: 0.5 },
  "CANON DIGITAL C800": { rate: 4000, setupHours: 0.5 },
};

// _press_opts / _finishing_opts (app.py:5395, 5413) — same
// SM/GTO/CANON substring classification, same source order.
const PRESS_MACHINE_OPTIONS = Object.keys(MACHINE_DATA).filter((m) =>
  ["SM", "GTO", "CANON"].some((k) => m.toUpperCase().includes(k))
);
const FINISHING_MACHINE_OPTIONS = Object.keys(MACHINE_DATA).filter(
  (m) => !["SM", "GTO", "CANON"].some((k) => m.toUpperCase().includes(k))
);

// Rough pre-flight estimate only — NOT the real scheduler (Phase 2's
// calculate_production_time walks the calendar day-by-day and accounts
// for weekends/existing backlog). This exists purely to catch a
// fat-fingered quantity (an extra zero or two) at data-entry time,
// before it silently jams a machine's schedule for a year+.
function estimateWorkingDays(impressions: number, machineName: string): number {
  const rate = MACHINE_DATA[machineName]?.rate || 1000;
  const hoursNeeded = impressions / rate;
  return hoursNeeded / Math.max(1, SHIFT_END_HOUR - SHIFT_START_HOUR);
}

// Local (system/browser) today's date as "YYYY-MM-DD" — matches
// Python's datetime.now().date() (naive local time). Lazy-initialized
// via useState, never called directly during render — same purity
// reasoning as every other Date-based default in this codebase.
function todayLocalDateStr(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function money(n: number): string {
  return `${CURRENCY}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Order-selector label format uses 0 decimals, matching the source's
// own f"{CURRENCY} {amount:,.0f}" exactly — distinct from the 2-decimal
// money() used everywhere else (including the summary card's own
// Contract Value tile just below it). Tight-currency prefix only
// (MIGRATION_STATUS.md's UI Conventions, rule 3) — the 0-decimal
// behavior itself is unrelated to that rule and stays as-is.
function moneyWhole(n: number): string {
  return `${CURRENCY}${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export interface ApprovedOrderRow {
  id: number;
  job_order_no: string | null;
  customer_name: string | null;
  total_amount: number | null;
  qty_to_print: number | null;
  type_of_print: string | null;
  created_by: string | null;
}

interface ComponentRow {
  machine: string;
  impressions: number;
}

export function ProductionLayoutClient({ orders }: { orders: ApprovedOrderRow[] }) {
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

  if (orders.length === 0) {
    return (
      <div className="rounded-at-lg border border-at-border bg-at-white p-6 text-sm text-at-slate shadow-at-sm">
        No approved orders available for production scheduling. Authorize orders in the
        Authorization Center first.
      </div>
    );
  }

  return (
    <div>
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search order number or customer name…"
        className="mb-3 w-full rounded-at border border-at-border bg-at-white px-4 py-2.5 text-sm text-at-navy outline-none focus:border-at-accent"
      />
      <select
        value={selectedOrderNo}
        onChange={(e) => setSelectedOrderNo(e.target.value)}
        className="mb-6 w-full max-w-2xl rounded-at border border-at-border bg-at-white px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
      >
        <option value="">— Select an order —</option>
        {candidates
          .filter((o): o is ApprovedOrderRow & { job_order_no: string } => Boolean(o.job_order_no))
          .map((o) => (
            <option key={o.id} value={o.job_order_no}>
              {o.job_order_no} — {o.customer_name || "—"} ({moneyWhole(Number(o.total_amount ?? 0))})
            </option>
          ))}
      </select>

      {candidates.length === 0 && (
        <div className="mb-3 text-sm text-at-slate">No orders match your search.</div>
      )}

      {target && (
        <>
          <div className="mb-6 flex flex-wrap gap-8 rounded-at-lg border border-at-border bg-at-bg p-4">
            <SummaryTile label="Customer" value={target.customer_name || "—"} />
            <SummaryTile label="Quantity" value={(target.qty_to_print ?? 0).toLocaleString()} />
            <SummaryTile label="Print Category" value={target.type_of_print || "—"} />
            <SummaryTile
              label="Contract Value"
              value={money(Number(target.total_amount ?? 0))}
              valueColor="#10b981"
            />
          </div>
          <LayoutForm key={target.id} order={target} />
        </>
      )}
    </div>
  );
}

function SummaryTile({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div>
      <div className="mb-0.5 text-[0.65rem] font-bold uppercase tracking-wide text-at-slate-light">{label}</div>
      <div className="font-bold text-at-navy" style={valueColor ? { color: valueColor } : undefined}>
        {value}
      </div>
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return <div className="mb-3 mt-6 text-sm font-bold uppercase tracking-wide text-at-navy first:mt-0">{children}</div>;
}

function LayoutForm({ order }: { order: ApprovedOrderRow }) {
  const [jobName, setJobName] = useState(order.customer_name ?? "");
  const [salesRep, setSalesRep] = useState(order.created_by ?? "");
  // Lazy initializer — see todayLocalDateStr's own purity note.
  const [startDate, setStartDate] = useState(() => todayLocalDateStr());
  const [totalQty, setTotalQty] = useState(order.qty_to_print || 1000);
  const [ups, setUps] = useState(1);
  const [totalVal, setTotalVal] = useState(Number(order.total_amount ?? 0));

  const [numComponents, setNumComponents] = useState(1);
  const [components, setComponents] = useState<ComponentRow[]>([
    { machine: PRESS_MACHINE_OPTIONS[0], impressions: Math.ceil((order.qty_to_print || 1000) / 1) },
  ]);

  // Growing the component count seeds new slots with the current
  // total_qty/ups default; shrinking just truncates. Existing slots are
  // left exactly as the operator set them — matches Streamlit's
  // key-based widget persistence (a number_input's `value=` is only its
  // INITIAL default; once rendered, changing lf_total_qty/lf_type_id on
  // a later rerun does not retroactively overwrite what's already there).
  function handleNumComponentsChange(n: number) {
    const clamped = Math.max(1, Math.min(MAX_COMPONENTS, n));
    setNumComponents(clamped);
    setComponents((prev) => {
      const next = prev.slice(0, clamped);
      while (next.length < clamped) {
        next.push({
          machine: PRESS_MACHINE_OPTIONS[0],
          impressions: Math.ceil(totalQty / Math.max(1, ups)),
        });
      }
      return next;
    });
  }

  function updateComponent(index: number, patch: Partial<ComponentRow>) {
    setComponents((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }

  const [selectedFinishing, setSelectedFinishing] = useState<Set<string>>(new Set());
  function toggleFinishing(machine: string) {
    setSelectedFinishing((prev) => {
      const next = new Set(prev);
      if (next.has(machine)) next.delete(machine);
      else next.add(machine);
      return next;
    });
  }
  // Preserves FINISHING_MACHINE_OPTIONS' order, not click order — matches
  // checkbox_multiselect's documented return contract exactly. Phase 2's
  // add_multi_part_job re-sorts this into Die Cutter → Folder Gluer →
  // Others itself when it builds the schedule; this list is exactly the
  // unsorted shape that function actually receives as input.
  const finishingSelected = FINISHING_MACHINE_OPTIONS.filter((m) => selectedFinishing.has(m));

  // Pre-flight sanity check (app.py:5419-5444) — catches a fat-fingered
  // quantity before it silently jams a machine's schedule.
  const flags = useMemo(() => {
    const result: string[] = [];
    components.forEach((c, i) => {
      const days = estimateWorkingDays(c.impressions, c.machine);
      if (days > STAGE_DAYS_WARNING_THRESHOLD) {
        result.push(
          `Component ${i + 1} (${c.machine}): ~${Math.round(days)} working days for ${c.impressions.toLocaleString()} impressions`
        );
      }
    });
    finishingSelected.forEach((m) => {
      const days = estimateWorkingDays(totalQty, m);
      if (days > STAGE_DAYS_WARNING_THRESHOLD) {
        result.push(`${m}: ~${Math.round(days)} working days for ${totalQty.toLocaleString()} units`);
      }
    });
    return result;
  }, [components, finishingSelected, totalQty]);

  const [override, setOverride] = useState(false);
  const [missingFields, setMissingFields] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [committedCount, setCommittedCount] = useState<number | null>(null);

  function handleSubmit() {
    const missing: string[] = [];
    if (!jobName.trim()) missing.push("Job Name");
    if (totalQty < 1) missing.push("Total Quantity");
    if (flags.length > 0 && !override) {
      missing.push("confirmation of the unusually long schedule flagged above");
    }

    setMissingFields(missing);
    if (missing.length > 0) {
      return;
    }

    setError(null);
    setCommittedCount(null);
    if (!order.job_order_no) {
      setError("This order has no job_order_no — cannot schedule.");
      return;
    }

    startTransition(async () => {
      const result = await commitProductionPlan({
        orderId: order.id,
        jobOrderNo: order.job_order_no as string,
        name: jobName.trim(),
        salesRep: salesRep.trim(),
        startDate,
        totalQty,
        typeId: ups,
        totalVal,
        components,
        finishingMachines: finishingSelected,
      });
      if (result.error) {
        setError(result.error);
      } else {
        setCommittedCount(result.recordCount ?? 0);
      }
    });
  }

  return (
    <div className="rounded-at-lg border border-at-border bg-at-white p-6 shadow-at-sm">
      <SectionHeader>Job Identification</SectionHeader>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <FormField label="Job Name / Identifier ★">
          <input
            type="text"
            value={jobName}
            onChange={(e) => setJobName(e.target.value)}
            className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
          />
        </FormField>
        <FormField label="Sales Representative">
          <input
            type="text"
            value={salesRep}
            onChange={(e) => setSalesRep(e.target.value)}
            className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
          />
        </FormField>
        <FormField label="Job Start Date ★">
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
          />
        </FormField>
      </div>

      <SectionHeader>Production Dimensions</SectionHeader>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <FormField label="Total Finished Quantity ★">
          <input
            type="number"
            min={1}
            value={totalQty}
            onChange={(e) => setTotalQty(Number(e.target.value))}
            className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
          />
        </FormField>
        <FormField label="Number of Ups / Type ID ★">
          <input
            type="number"
            min={1}
            max={64}
            value={ups}
            onChange={(e) => setUps(Number(e.target.value))}
            className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
          />
        </FormField>
        <FormField label={`Total Contract Value (${CURRENCY})`}>
          <input
            type="number"
            min={0}
            value={totalVal}
            onChange={(e) => setTotalVal(Number(e.target.value))}
            className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
          />
        </FormField>
      </div>

      <SectionHeader>Printing Presses — Components</SectionHeader>
      <div className="mb-3 text-xs text-at-slate">
        Define one or more print components. Each component represents a distinct substrate run
        on a press.
      </div>
      <div className="mb-4 max-w-xs">
        <FormField label="Number of Print Components">
          <input
            type="number"
            min={1}
            max={MAX_COMPONENTS}
            value={numComponents}
            onChange={(e) => handleNumComponentsChange(Number(e.target.value))}
            className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
          />
        </FormField>
      </div>

      <div className="flex flex-col gap-3">
        {components.map((c, i) => {
          const defaultImps = Math.ceil(totalQty / Math.max(1, ups));
          return (
            <div key={i} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField label={`Press Machine — Component ${i + 1}`}>
                <select
                  value={c.machine}
                  onChange={(e) => updateComponent(i, { machine: e.target.value })}
                  className="w-full rounded-at border border-at-border bg-at-white px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
                >
                  {PRESS_MACHINE_OPTIONS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField
                label={`Press Impressions — Component ${i + 1}`}
                hint={`Defaults to ${totalQty.toLocaleString()} qty ÷ ${ups} ups = ${defaultImps.toLocaleString()} press impressions.`}
              >
                <input
                  type="number"
                  min={1}
                  value={c.impressions}
                  onChange={(e) => updateComponent(i, { impressions: Number(e.target.value) })}
                  className="w-full rounded-at border border-at-border bg-at-bg px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
                />
              </FormField>
            </div>
          );
        })}
      </div>

      <SectionHeader>Post-Press &amp; Finishing Machines</SectionHeader>
      <div className="mb-2 text-sm font-semibold text-at-navy">
        Select Finishing Machines (applied in order: Die Cutter → Folder Gluer → Others)
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {FINISHING_MACHINE_OPTIONS.map((m) => (
          <label key={m} className="flex items-center gap-2 text-sm text-at-slate">
            <input type="checkbox" checked={selectedFinishing.has(m)} onChange={() => toggleFinishing(m)} />
            {m}
          </label>
        ))}
      </div>

      {flags.length > 0 && (
        <div className="mt-4 rounded-at border-l-4 border-at-danger bg-at-danger-bg px-4 py-3">
          <div className="mb-1.5 text-sm font-bold text-at-danger-text">
            This schedule looks unusually long — double-check quantities before committing:
          </div>
          <ul className="mb-2 list-disc pl-5 text-sm text-at-danger-text">
            {flags.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
          <label className="flex items-center gap-2 text-sm font-semibold text-at-danger-text">
            <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
            I&apos;ve double-checked these quantities and want to commit this schedule anyway
          </label>
        </div>
      )}

      {missingFields.length > 0 && (
        <div className="mt-4 text-sm font-semibold text-red-600">
          Cannot commit plan — missing required fields: {missingFields.join(", ")}
        </div>
      )}

      {error && <div className="mt-4 text-sm font-semibold text-red-600">{error}</div>}

      <div className="mt-6">
        <Button disabled={isPending} onClick={handleSubmit}>
          {isPending ? "CALCULATING SCHEDULE…" : "CALCULATE SCHEDULE & COMMIT TO PRODUCTION PLAN"}
        </Button>
      </div>

      {committedCount !== null && (
        <div className="mt-4 rounded-at border border-at-success bg-at-success-bg px-4 py-3 text-sm font-semibold text-at-success-text">
          Production plan committed for &apos;{jobName}&apos; — {committedCount} machine stage
          {committedCount === 1 ? "" : "s"} scheduled and written to Shop Floor Control. Order{" "}
          {order.job_order_no} moved to &apos;In Production&apos;.
        </div>
      )}
    </div>
  );
}

function FormField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">{label}</label>
      {children}
      {hint && <div className="mt-1 text-[0.7rem] text-at-slate-light">{hint}</div>}
    </div>
  );
}
