import { cn } from "@/lib/utils";

interface MetricCardProps {
  // React.ReactNode, not just string (2026-08-31, UI Conventions rule 5's
  // same "widen rather than hand-roll a second component" precedent) — so
  // a caller needing an inline InfoPopover next to the label doesn't need
  // a separate metric-tile implementation. Every existing plain-string
  // caller keeps working unchanged.
  label: React.ReactNode;
  value: string | number;
  // Optional secondary line rendered below the main value — for a tile
  // that needs to show two related numbers together (e.g. Active Orders'
  // count alongside its dollar value) rather than splitting into two
  // separate tiles.
  subValue?: string | number;
  accentColor?: string; // e.g. "#0369a1" — matches border-bottom-color overrides in app.py
  /** Overrides the border color independently of accentColor, for cards
   * whose app.py source uses a different shade for the border vs. the
   * value text (e.g. My Order Tracker's KPI row). Defaults to accentColor. */
  borderColor?: string;
  valueClassName?: string;
  /** Compact sizing (2026-08-31 Command Center density pass) — smaller
   * padding, a lower value-font ceiling, and tighter label/value/subValue
   * spacing, for a KPI row meant to be scanned as a block rather than
   * read tile-by-tile. Defaults to false so every other existing caller
   * (e.g. My Order Tracker's KPI row) renders exactly as before. */
  dense?: boolean;
}

// Shrinks proactively as the rendered value gets longer (real contract
// values will keep growing past six figures) so wrapping is the exception,
// not the norm. Tiered by character count, not value type, so any future
// KPI benefits without a per-call override. Only used when the caller
// doesn't pass an explicit valueClassName size — twMerge (via cn) keeps
// the last conflicting text-size class, so an explicit override still wins.
// The `dense` tiers scale every step down proportionately, capping the
// shortest values (plain counts) at ~28px rather than 32px, to match a
// reference layout's tighter number sizing without losing the same
// length-based wrapping safety net.
function autoValueSize(text: string, dense: boolean): string {
  const length = text.length;
  if (dense) {
    if (length <= 6) return "text-[1.75rem]";
    if (length <= 10) return "text-[1.5rem]";
    if (length <= 14) return "text-[1.2rem]";
    if (length <= 18) return "text-[1.05rem]";
    return "text-[0.9rem]";
  }
  if (length <= 6) return "text-[2rem]";
  if (length <= 10) return "text-[1.75rem]";
  if (length <= 14) return "text-[1.35rem]";
  if (length <= 18) return "text-[1.15rem]";
  return "text-[1rem]";
}

export function MetricCard({
  label,
  value,
  subValue,
  accentColor,
  borderColor,
  valueClassName,
  dense,
}: MetricCardProps) {
  const valueText = String(value);

  return (
    <div
      className={cn(
        "min-w-0 rounded-at-lg border border-at-border bg-at-white shadow-at-sm transition-all hover:-translate-y-0.5 hover:shadow-at-md",
        dense ? "p-3" : "p-6"
      )}
      style={{ borderBottom: `4px solid ${borderColor ?? accentColor ?? "var(--at-navy)"}` }}
    >
      <div
        className={cn(
          "flex items-center gap-1.5 text-[0.8rem] font-bold uppercase leading-tight tracking-wide text-at-slate",
          dense ? "min-h-[1.4rem]" : "min-h-[2rem]"
        )}
      >
        {label}
      </div>
      <div
        className={cn(
          "max-w-full break-words font-extrabold tracking-tight text-at-navy",
          dense ? "mt-1" : "mt-2",
          autoValueSize(valueText, Boolean(dense)),
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
      {subValue !== undefined && (
        <div
          className={cn(
            "max-w-full break-words font-semibold text-at-slate",
            dense ? "mt-0.5 text-xs" : "mt-1 text-sm"
          )}
        >
          {subValue}
        </div>
      )}
    </div>
  );
}
