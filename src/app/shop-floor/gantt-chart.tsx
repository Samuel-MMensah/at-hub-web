"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

// Shared by all three Shop Floor Control timelines (Production Pipeline,
// per-order drill-down, Machine Utilisation) — same rendering mechanic
// (offset+duration stacked bar per row against a time x-axis, "now"
// reference line, custom tooltip), only the color map/keys and tooltip
// content differ per chart. Built with Recharts' stacked-bar range-bar
// technique since Recharts has no native Gantt component.
export interface GanttRow {
  id: string;
  label: string;
  start: number; // ms since epoch
  end: number; // ms since epoch
  colorKey: string;
  tooltipLines: string[];
}

interface GanttChartProps {
  rows: GanttRow[];
  colorMap: Record<string, string>;
  nowLineColor: string;
  legendTitle: string;
  emptyMessage: string;
}

const AXIS_TICK_STYLE = { fill: "#64748b", fontSize: 11 };

function formatAxisDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

function GanttTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: GanttRow }[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-at border border-at-border bg-at-white px-3 py-2 shadow-at-md">
      <div className="mb-1 text-xs font-bold text-at-navy">{row.label}</div>
      {row.tooltipLines.map((line, i) => (
        <div key={i} className="text-xs text-at-slate">
          {line}
        </div>
      ))}
    </div>
  );
}

export function GanttChart({ rows, colorMap, nowLineColor, legendTitle, emptyMessage }: GanttChartProps) {
  // Lazy initializer: runs exactly once, on mount, not on every render —
  // React's own sanctioned pattern for one-time impure/expensive setup,
  // unlike calling Date.now() directly in the render body.
  const [now] = useState(() => Date.now());

  if (rows.length === 0) {
    return (
      <div className="rounded-at-lg border border-at-border bg-at-white p-6 text-sm text-at-slate shadow-at-sm">
        {emptyMessage}
      </div>
    );
  }

  const domainMin = Math.min(...rows.map((r) => r.start));
  const domainMax = Math.max(...rows.map((r) => r.end));

  const data = rows.map((row) => ({
    ...row,
    offset: row.start - domainMin,
    duration: Math.max(row.end - row.start, 0),
  }));

  const legendKeys = Array.from(new Set(rows.map((r) => r.colorKey)));

  return (
    <div className="rounded-at-lg border border-at-border bg-at-white p-4 shadow-at-sm">
      <div className="mb-2 text-[0.65rem] font-bold uppercase tracking-wide text-at-slate">
        {legendTitle}
      </div>
      <div className="mb-3 flex flex-wrap gap-3">
        {legendKeys.map((key) => (
          <div key={key} className="flex items-center gap-1.5 text-xs text-at-slate">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: colorMap[key] ?? "#94a3b8" }}
            />
            {key}
          </div>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={Math.max(220, 46 * rows.length)}>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }}>
          <CartesianGrid stroke="#f1f5f9" horizontal={false} />
          <XAxis
            type="number"
            domain={[0, domainMax - domainMin]}
            tickFormatter={(v: number) => formatAxisDate(domainMin + v)}
            tick={AXIS_TICK_STYLE}
            axisLine={{ stroke: "#e2e8f0" }}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="label"
            tick={AXIS_TICK_STYLE}
            axisLine={false}
            tickLine={false}
            width={200}
          />
          <Tooltip content={<GanttTooltip />} />
          <ReferenceLine x={now - domainMin} stroke={nowLineColor} strokeDasharray="4 4" />
          <Bar dataKey="offset" stackId="gantt" fill="transparent" isAnimationActive={false} />
          <Bar dataKey="duration" stackId="gantt" radius={[3, 3, 3, 3]} isAnimationActive={false}>
            {data.map((entry) => (
              <Cell key={entry.id} fill={colorMap[entry.colorKey] ?? "#94a3b8"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
