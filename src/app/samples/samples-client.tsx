"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Download } from "lucide-react";
import { CollapsibleMonthGroup } from "@/components/ui/collapsible-month-group";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { currentMonthKey, groupByMonth, monthKeyAndLabel, type MonthGroup } from "@/lib/month-groups";
import { weekKeyAndLabel } from "@/lib/week-groups";

export interface SampleRow {
  sample_id: number;
  sample_job_order_no: string | null;
  customer_name: string | null;
  sample_reason: string | null;
  order_date: string | null;
  is_converted: boolean;
  converted_order_id: number | null;
  converted_job_order_no: string | null;
}

// The one reason string that means "never converts" — a sample marked
// this way is closed by definition (see Raise Job Order's sample
// fields). Matched exactly against the real CHECK-constrained value.
const COMPLIMENTARY_REASON = "Complimentary — No Charge Expected";

// A sample needs to have been on record a while before a 0 conversion
// is fair — one raised yesterday hasn't had a real chance yet. The
// conversion-rate figure only counts samples at least this old, so
// very recent ones don't drag it down misleadingly (same honesty
// posture as AR Aging's caption). The trend CHART still shows every
// period's real counts; only the summary RATE applies this window.
const MATURITY_DAYS = 30;

// Both from this app's already-validated 7-slot categorical palette
// (revenue-analysis-client.tsx, validated against the card surface):
// slot 1 (blue) and slot 3 (green). Green = the positive outcome
// (converted), same green/positive convention used elsewhere.
const RAISED_COLOR = "#2a78d6";
const CONVERTED_COLOR = "#1baf7a";

const AXIS_TICK_STYLE = { fill: "#64748b", fontSize: 12 };
const GRID_COLOR = "#f1f5f9";
const BORDER_COLOR = "#e2e8f0";

type Period = "Weekly" | "Monthly";
type SampleState = "Awaiting Decision" | "Converted" | "Complimentary — Closed";

// Plain Postgres DATE ("2026-08-07") — parsed as UTC midnight, same
// reasoning already established across this app.
function parseDateOnly(raw: string): Date {
  return new Date(raw);
}

function todayUtcMidnight(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function daysSince(dateStr: string): number {
  return Math.floor((todayUtcMidnight().getTime() - parseDateOnly(dateStr).getTime()) / 86400000);
}

function classifyState(s: SampleRow): SampleState {
  if (s.sample_reason === COMPLIMENTARY_REASON) return "Complimentary — Closed";
  if (s.is_converted) return "Converted";
  return "Awaiting Decision";
}

function stateTone(state: SampleState): "success" | "warning" | "idle" {
  if (state === "Converted") return "success";
  if (state === "Awaiting Decision") return "warning";
  return "idle";
}

// Same tooltip shape as revenue-analysis-client.tsx's ChartTooltip —
// duplicated locally per this codebase's per-file convention.
function ChartTooltip({
  active,
  label,
  payload,
}: {
  active?: boolean;
  label?: string;
  payload?: { name: string; value: number; color: string }[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-at border border-at-border bg-at-white px-3 py-2 shadow-at-md">
      {label && <div className="mb-1 text-xs font-bold text-at-slate">{label}</div>}
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center gap-2 text-xs">
          <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
          <span className="text-at-slate">{entry.name}:</span>
          <span className="font-bold text-at-navy">{entry.value}</span>
        </div>
      ))}
    </div>
  );
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function downloadCsv(columns: string[], rows: string[][]) {
  const lines = [columns.join(","), ...rows.map((row) => row.map(csvEscape).join(","))];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  link.href = url;
  link.download = `ATP_samples_${yyyy}${mm}${dd}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

const CSV_COLUMNS = ["Sample Order No", "Customer", "Raised", "Reason", "State", "Converted Order No"];

function sampleToCsvRow(s: SampleRow): string[] {
  return [
    s.sample_job_order_no ?? "",
    s.customer_name ?? "",
    s.order_date ?? "",
    s.sample_reason ?? "",
    classifyState(s),
    s.converted_job_order_no ?? "",
  ];
}

export function SamplesClient({ samples }: { samples: SampleRow[] }) {
  const [period, setPeriod] = useState<Period>("Monthly");

  // Conversion rate — convertible (awaiting-decision) samples only, and
  // only those mature enough to have had a fair chance. Complimentary
  // samples are excluded because they never convert by definition;
  // counting them would understate the real rate.
  const rate = useMemo(() => {
    const convertible = samples.filter((s) => s.sample_reason !== COMPLIMENTARY_REASON);
    const mature = convertible.filter((s) => s.order_date && daysSince(s.order_date) >= MATURITY_DAYS);
    const converted = mature.filter((s) => s.is_converted).length;
    return {
      convertibleTotal: convertible.length,
      matureCount: mature.length,
      convertedCount: converted,
      pct: mature.length > 0 ? Math.round((converted / mature.length) * 100) : null,
    };
  }, [samples]);

  // Trend counts EVERY sample by the date it was raised — Converted is
  // the subset of that period's samples now converted, so Converted is
  // always ≤ Raised within a period (a clean cohort view).
  const trend = useMemo(() => {
    const map = new Map<string, { key: string; label: string; Raised: number; Converted: number }>();
    for (const s of samples) {
      if (!s.order_date) continue;
      const d = parseDateOnly(s.order_date);
      const { key, label } = period === "Weekly" ? weekKeyAndLabel(d) : monthKeyAndLabel(d);
      let b = map.get(key);
      if (!b) {
        b = { key, label, Raised: 0, Converted: 0 };
        map.set(key, b);
      }
      b.Raised += 1;
      if (s.is_converted) b.Converted += 1;
    }
    return Array.from(map.values())
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((b) => ({ period: b.label, Raised: b.Raised, Converted: b.Converted }));
  }, [samples, period]);

  const monthGroups: MonthGroup<SampleRow>[] = useMemo(() => {
    const withDate = samples.filter((s) => s.order_date);
    const withoutDate = samples.filter((s) => !s.order_date);
    const groups = groupByMonth(withDate, (s) => parseDateOnly(s.order_date as string));
    if (withoutDate.length > 0) groups.push({ key: "", label: "Unknown Date", items: withoutDate });
    return groups;
  }, [samples]);
  const currentKey = currentMonthKey();

  return (
    <div>
      {/* Conversion-rate summary — the honest headline figure */}
      <div className="mb-6 rounded-at-lg border border-at-border bg-at-white p-5 shadow-at-sm">
        <div className="mb-1 text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
          Sample Conversion Rate
        </div>
        {rate.pct !== null ? (
          <>
            <div className="text-2xl font-extrabold text-at-navy">
              {rate.pct}%{" "}
              <span className="text-sm font-semibold text-at-slate">
                ({rate.convertedCount} of {rate.matureCount})
              </span>
            </div>
            <div className="mt-1 text-xs text-at-slate">
              Of awaiting-decision samples raised more than {MATURITY_DAYS} days ago — old enough to
              have had a fair chance to convert. More recent samples, and complimentary (closed)
              samples, are excluded from this figure.
            </div>
          </>
        ) : (
          <>
            <div className="text-2xl font-extrabold text-at-slate">—</div>
            <div className="mt-1 text-xs text-at-slate">
              {rate.convertibleTotal === 0
                ? "No awaiting-decision samples raised yet — nothing to measure a conversion rate against."
                : `Not enough elapsed time yet — none of the ${rate.convertibleTotal} awaiting-decision sample(s) on record are older than ${MATURITY_DAYS} days, the window a sample needs to have had a fair chance to convert.`}
            </div>
          </>
        )}
      </div>

      {/* Trend chart */}
      <div className="mb-6 rounded-at-lg border border-at-border bg-at-white p-4 shadow-at-sm">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs font-bold uppercase tracking-wide text-at-slate">
            Samples Raised vs. Converted
          </div>
          <div className="flex gap-2">
            {(["Weekly", "Monthly"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setPeriod(option)}
                className={`rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors ${
                  period === option
                    ? "border-at-navy bg-at-navy text-at-white"
                    : "border-at-border bg-at-white text-at-slate hover:border-at-accent"
                }`}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
        <div className="mb-3 text-xs text-at-slate">
          Every sample is counted in the period it was raised; Converted is the subset of that
          period&apos;s samples whose follow-up order has reached Approved or beyond.
        </div>
        {trend.length === 0 ? (
          <div className="py-10 text-center text-sm text-at-slate">No samples raised yet.</div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={trend} barGap={4} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
              <CartesianGrid stroke={GRID_COLOR} vertical={false} />
              <XAxis dataKey="period" tick={AXIS_TICK_STYLE} axisLine={{ stroke: BORDER_COLOR }} tickLine={false} />
              <YAxis
                tick={AXIS_TICK_STYLE}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
                width={40}
              />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: "#f8fafc" }} />
              <Legend
                verticalAlign="top"
                align="left"
                height={32}
                iconType="circle"
                iconSize={8}
                wrapperStyle={{ fontSize: 12, color: "#64748b" }}
              />
              <Bar dataKey="Raised" name="Raised" fill={RAISED_COLOR} radius={[4, 4, 0, 0]} maxBarSize={48} />
              <Bar dataKey="Converted" name="Converted" fill={CONVERTED_COLOR} radius={[4, 4, 0, 0]} maxBarSize={48} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* List */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-base font-bold text-at-navy">All Samples</div>
        <Button onClick={() => downloadCsv(CSV_COLUMNS, samples.map(sampleToCsvRow))} disabled={samples.length === 0}>
<Download size={14} /> Download Samples CSV
        </Button>
      </div>

      {samples.length === 0 ? (
        <div className="rounded-at-lg border border-at-border bg-at-white p-6 text-sm text-at-slate shadow-at-sm">
          No samples on record yet.
        </div>
      ) : (
        monthGroups.map((month) => (
          <CollapsibleMonthGroup
            key={month.key}
            monthLabel={month.label}
            itemCount={month.items.length}
            itemLabel="samples"
            defaultExpanded={month.key === currentKey}
          >
            <div className="-mx-4 -my-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-at-border bg-at-bg">
                    {["Sample Order No", "Customer", "Raised", "Reason", "State", "Converted Order"].map((col) => (
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
                  {month.items.map((s) => {
                    const state = classifyState(s);
                    return (
                      <tr key={s.sample_id} className="border-b border-at-border last:border-0 hover:bg-at-bg">
                        <td className="whitespace-nowrap px-4 py-2.5 font-semibold text-at-navy">
                          {s.sample_job_order_no || "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-at-navy">{s.customer_name || "—"}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-at-slate">{s.order_date || "—"}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-at-slate">{s.sample_reason || "—"}</td>
                        <td className="whitespace-nowrap px-4 py-2.5">
                          <StatusBadge label={state} tone={stateTone(state)} />
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5">
                          {s.converted_job_order_no ? (
                            <Link
                              href={`/search?q=${encodeURIComponent(s.converted_job_order_no)}`}
                              className="font-semibold text-at-accent hover:underline"
                            >
                              {s.converted_job_order_no}
                            </Link>
                          ) : (
                            <span className="text-at-slate">—</span>
                          )}
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
