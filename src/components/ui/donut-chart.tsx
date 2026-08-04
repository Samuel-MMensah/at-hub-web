"use client";

import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

export interface DonutSlice {
  name: string;
  value: number;
  color: string;
}

interface DonutChartProps {
  title: string;
  data: DonutSlice[];
  formatValue: (v: number) => string;
}

// Extracted from two independently-duplicated copies (Command Center's
// DepartmentDonut and Revenue Analysis's own Donut) that both had the
// same real bug: long "value (percent%)" labels clipped past their
// card's edge for large real currency values (e.g. "GH₵2,899,044.10
// (78%)") — the bug shipped in both places because each was a separate
// copy, only one of which got noticed. One real component now, fixed
// once.
//
// SVG <text> elements don't wrap, so the fix isn't CSS — it's three
// things together: (1) a smaller outer radius (60% vs the previous
// 78%/80%), leaving real physical room between the pie and the card
// edge; (2) explicit chart margin on all sides so that room is
// guaranteed, not incidental; (3) label font size that shrinks by
// rendered text length, same "proactively shrink as real values grow"
// strategy as MetricCard's autoValueSize (src/components/ui/
// metric-card.tsx, the fix for the earlier Contract Value KPI overflow)
// — tiered by character count so a future, larger real number benefits
// automatically rather than needing another one-off fix.
const RADIAN = Math.PI / 180;

function donutLabelFontSize(text: string): number {
  const length = text.length;
  if (length <= 12) return 12;
  if (length <= 18) return 11;
  if (length <= 24) return 10;
  return 9;
}

interface SliceLabelProps {
  cx?: number;
  cy?: number;
  midAngle?: number;
  outerRadius?: number;
  value?: number;
  percent?: number;
}

function renderSliceLabel(formatValue: (v: number) => string) {
  function SliceLabel({ cx = 0, cy = 0, midAngle = 0, outerRadius = 0, value, percent }: SliceLabelProps) {
    if (value == null || percent == null) return null;
    const text = `${formatValue(value)} (${(percent * 100).toFixed(0)}%)`;

    // Label sits just outside the (now smaller) pie, not centered on
    // it — anchored away from the pie's own center so text grows
    // outward into the margin reserved for it, rather than symmetric
    // growth that pushes further past whichever edge it already leans
    // toward.
    const radius = outerRadius + 16;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);
    const anchor = x > cx ? "start" : "end";

    return (
      <text
        x={x}
        y={y}
        textAnchor={anchor}
        dominantBaseline="central"
        fontSize={donutLabelFontSize(text)}
        fontWeight={700}
        fill="#0f172a"
      >
        {text}
      </text>
    );
  }
  return SliceLabel;
}

function DonutTooltip({
  active,
  payload,
  formatValue,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  formatValue: (v: number) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-at border border-at-border bg-at-white px-3 py-2 shadow-at-md">
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center gap-2 text-xs">
          <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
          <span className="text-at-slate">{entry.name}:</span>
          <span className="font-bold text-at-navy">{formatValue(entry.value)}</span>
        </div>
      ))}
    </div>
  );
}

export function DonutChart({ title, data, formatValue }: DonutChartProps) {
  return (
    <div className="rounded-at-lg border border-at-border bg-at-white p-4 shadow-at-sm">
      <div className="mb-2 text-xs font-bold uppercase tracking-wide text-at-slate">{title}</div>
      <ResponsiveContainer width="100%" height={260}>
        <PieChart margin={{ top: 24, right: 56, bottom: 24, left: 56 }}>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius="42%"
            outerRadius="60%"
            paddingAngle={2}
            label={renderSliceLabel(formatValue)}
            labelLine={false}
          >
            {data.map((entry) => (
              <Cell key={entry.name} fill={entry.color} stroke="#ffffff" strokeWidth={2} />
            ))}
          </Pie>
          <Tooltip content={<DonutTooltip formatValue={formatValue} />} />
          <Legend
            verticalAlign="bottom"
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 11, color: "#64748b" }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
