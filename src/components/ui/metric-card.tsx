import { cn } from "@/lib/utils";

interface MetricCardProps {
  label: string;
  value: string | number;
  accentColor?: string; // e.g. "#0369a1" — matches border-bottom-color overrides in app.py
  /** Overrides the border color independently of accentColor, for cards
   * whose app.py source uses a different shade for the border vs. the
   * value text (e.g. My Order Tracker's KPI row). Defaults to accentColor. */
  borderColor?: string;
  valueClassName?: string;
}

// Shrinks proactively as the rendered value gets longer (real contract
// values will keep growing past six figures) so wrapping is the exception,
// not the norm. Tiered by character count, not value type, so any future
// KPI benefits without a per-call override. Only used when the caller
// doesn't pass an explicit valueClassName size — twMerge (via cn) keeps
// the last conflicting text-size class, so an explicit override still wins.
function autoValueSize(text: string): string {
  const length = text.length;
  if (length <= 6) return "text-[2rem]";
  if (length <= 10) return "text-[1.75rem]";
  if (length <= 14) return "text-[1.35rem]";
  if (length <= 18) return "text-[1.15rem]";
  return "text-[1rem]";
}

export function MetricCard({ label, value, accentColor, borderColor, valueClassName }: MetricCardProps) {
  const valueText = String(value);

  return (
    <div
      className="min-w-0 rounded-at-lg border border-at-border bg-at-white p-6 shadow-at-sm transition-all hover:-translate-y-0.5 hover:shadow-at-md"
      style={{ borderBottom: `4px solid ${borderColor ?? accentColor ?? "var(--at-navy)"}` }}
    >
      <div className="min-h-[2rem] text-[0.8rem] font-bold uppercase leading-tight tracking-wide text-at-slate">
        {label}
      </div>
      <div
        className={cn(
          "mt-2 max-w-full break-words font-extrabold tracking-tight text-at-navy",
          autoValueSize(valueText),
          valueClassName
        )}
        style={{
          ...(accentColor ? { color: accentColor } : undefined),
          overflowWrap: "anywhere",
          wordBreak: "break-word",
        }}
      >
        {value}
      </div>
    </div>
  );
}
