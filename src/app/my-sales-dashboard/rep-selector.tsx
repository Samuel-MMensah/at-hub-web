"use client";

import { useRouter } from "next/navigation";

// Manager-only — gated by the caller (page.tsx checks
// user.isSalesManager before rendering this at all). Navigates via a
// real ?rep= URL param rather than local state, so the Server Component
// re-fetches that rep's job_orders/job_invoices from scratch on every
// selection — no client-side data fetching here, no stale previous
// rep's rows left behind.
export function RepSelector({ options, currentRep }: { options: string[]; currentRep: string | null }) {
  const router = useRouter();

  return (
    <div className="mb-4 max-w-md">
      <label className="mb-1 block text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
        Viewing Dashboard For
      </label>
      <select
        value={currentRep ?? ""}
        onChange={(e) => router.push(`/my-sales-dashboard?rep=${encodeURIComponent(e.target.value)}`)}
        className="w-full rounded-at border border-at-border bg-at-white px-3 py-2 text-sm text-at-navy outline-none focus:border-at-accent"
      >
        {options.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </div>
  );
}
