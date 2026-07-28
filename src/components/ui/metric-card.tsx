import { cn } from "@/lib/utils";

interface MetricCardProps {
  label: string;
  value: string | number;
  accentColor?: string; // e.g. "#0369a1" — matches border-bottom-color overrides in app.py
  valueClassName?: string;
}

export function MetricCard({ label, value, accentColor, valueClassName }: MetricCardProps) {
  return (
    <div
      className="rounded-at-lg border border-at-border bg-at-white p-6 shadow-at-sm transition-all hover:-translate-y-0.5 hover:shadow-at-md"
      style={{ borderBottom: `4px solid ${accentColor ?? "var(--at-navy)"}` }}
    >
      <div className="text-[0.8rem] font-bold uppercase tracking-wide text-at-slate">
        {label}
      </div>
      <div
        className={cn(
          "mt-2 text-[2rem] font-extrabold tracking-tight text-at-navy",
          valueClassName
        )}
        style={accentColor ? { color: accentColor } : undefined}
      >
        {value}
      </div>
    </div>
  );
}
