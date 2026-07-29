import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Width is opt-in per instance, not the baseline — default false. */
  fullWidth?: boolean;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-at-navy text-at-white hover:bg-at-navy-soft",
  secondary: "border border-at-border bg-at-white text-at-navy hover:border-at-accent hover:text-at-accent",
  danger: "bg-at-danger text-at-white hover:bg-red-600",
  // Matches the existing disabled "coming soon" buttons (PDF export,
  // Notify Finance) exactly — always disabled, never an interactive style.
  ghost: "bg-slate-100 text-at-slate-light",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2.5 text-sm",
  lg: "px-5 py-3 text-base",
};

export function Button({
  variant = "primary",
  size = "md",
  fullWidth = false,
  disabled,
  className,
  type = "button",
  ...props
}: ButtonProps) {
  const isDisabled = disabled || variant === "ghost";

  return (
    <button
      type={type}
      disabled={isDisabled}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-bold transition-colors",
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        fullWidth && "w-full",
        isDisabled && "cursor-not-allowed",
        isDisabled && variant !== "ghost" && "opacity-60",
        className
      )}
      {...props}
    />
  );
}
