"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

interface CollapsibleMonthGroupProps {
  // Widened from `string` to `React.ReactNode` (2026-08-31, UI
  // Conventions rule 5) so a caller whose header needs inline styling
  // (e.g. a colored warning span) can still use this ONE sanctioned
  // expand/collapse component instead of hand-rolling a second one —
  // every existing plain-string caller keeps working unchanged, since a
  // string is itself a valid ReactNode.
  monthLabel: React.ReactNode;
  // Optional (2026-08-31, UI Conventions rule 5) — a form/settings panel
  // (e.g. Shop Floor Control's Operator Update) has no countable "items"
  // at all; omit both this and itemLabel rather than forcing an
  // artificial count just to reuse this component.
  itemCount?: number;
  itemLabel?: string;
  /** Whether this month should be expanded right now, computed fresh by
   * the caller on every render (current month, or a search/filter is
   * active — see the two call sites for the exact rule). This isn't
   * just an initial value: flipping from false -> true force-reopens a
   * month the user had manually collapsed, which is what guarantees a
   * search match inside a collapsed month is never silently hidden.
   * Flipping true -> false does NOT auto-collapse — a user's manual
   * exploration of an unrelated month is never yanked shut by a
   * re-render. */
  defaultExpanded: boolean;
  children: React.ReactNode;
}

export function CollapsibleMonthGroup({
  monthLabel,
  itemCount,
  itemLabel = "orders",
  defaultExpanded,
  children,
}: CollapsibleMonthGroupProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  // Adjusting state during render (React's documented pattern for this,
  // not a useEffect) instead of an effect-triggered setState, which
  // would cause an extra cascading render for the same result.
  const [prevDefaultExpanded, setPrevDefaultExpanded] = useState(defaultExpanded);
  if (defaultExpanded !== prevDefaultExpanded) {
    setPrevDefaultExpanded(defaultExpanded);
    if (defaultExpanded) setExpanded(true);
  }

  return (
    <div className="mb-3 rounded-at-lg border border-at-border bg-at-white shadow-at-sm">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-bold text-at-navy hover:bg-at-bg"
      >
        <span className="text-at-slate-light">
          {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </span>
        {monthLabel}
        {itemCount !== undefined && (
          <span className="font-semibold text-at-slate">
            ({itemCount} {itemLabel})
          </span>
        )}
      </button>

      {expanded && <div className="border-t border-at-border px-4 py-4">{children}</div>}
    </div>
  );
}
