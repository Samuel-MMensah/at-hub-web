import { cn } from "@/lib/utils";

type StatusTone = "success" | "warning" | "danger" | "idle" | "accent" | "sample";

const TONE_CLASSES: Record<StatusTone, string> = {
  success: "bg-at-success-bg text-at-success-text",
  warning: "bg-at-warning-bg text-at-warning-text",
  danger: "bg-red-50 text-at-danger",
  idle: "bg-slate-100 text-slate-600",
  accent: "bg-sky-50 text-at-accent",
  // Genuinely distinct from every other tone above — violet, not
  // reused from any real order status. "Sample" is orthogonal to
  // status (a sample order still moves through the same Approved / In
  // Production / etc lifecycle), so it needs its own color, never one
  // that already means something else on this badge.
  sample: "bg-violet-100 text-violet-800",
};

interface StatusBadgeProps {
  label: string;
  tone?: StatusTone;
  className?: string;
  /** Native tooltip on hover — used by the SAMPLE badge to surface
   * sample_reason without a second UI element. */
  title?: string;
}

export function StatusBadge({ label, tone = "idle", className, title }: StatusBadgeProps) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[0.7rem] font-bold uppercase tracking-wide",
        TONE_CLASSES[tone],
        className
      )}
    >
      {label}
    </span>
  );
}
