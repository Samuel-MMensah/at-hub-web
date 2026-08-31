import { Lock } from "lucide-react";

interface RestrictedAccessProps {
  message: string;
}

// Always shows the same Lock icon — previously an opt-in `icon` string
// prop (usually a "🔒" emoji) that only 3 of this component's 16 real
// callers actually passed, so 13 pages silently rendered with no icon at
// all. Since every real caller wants the same icon for the same concept,
// there's no reason for it to be per-caller opt-in.
export function RestrictedAccess({ message }: RestrictedAccessProps) {
  return (
    <div className="mt-12 text-center">
      <Lock size={40} strokeWidth={1.75} className="mx-auto mb-4 text-at-slate-light" />
      <div className="mb-2 text-2xl font-extrabold text-at-navy">Restricted Access</div>
      <div className="mx-auto max-w-[420px] text-base leading-relaxed text-at-slate">
        {message}
      </div>
    </div>
  );
}
