import { cn } from "@/lib/utils";

type StatusTone = "success" | "warning" | "danger" | "idle" | "accent";

const TONE_CLASSES: Record<StatusTone, string> = {
  success: "bg-at-success-bg text-at-success-text",
  warning: "bg-at-warning-bg text-at-warning-text",
  danger: "bg-red-50 text-at-danger",
  idle: "bg-slate-100 text-slate-600",
  accent: "bg-sky-50 text-at-accent",
};

interface StatusBadgeProps {
  label: string;
  tone?: StatusTone;
  className?: string;
}

export function StatusBadge({ label, tone = "idle", className }: StatusBadgeProps) {
  return (
    <span
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
