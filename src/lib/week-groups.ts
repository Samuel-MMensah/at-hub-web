// Shared week-bucketing logic — extracted from command-center/charts.tsx's
// local weekStart() now that Revenue Analysis is a second real consumer,
// same "extracted as a refactor once a second caller needs it" pattern
// already used for isGarment/parseTimestamptz (see MIGRATION_STATUS.md's
// "Shared infrastructure"). Behavior unchanged from the original — this
// is a relocation, not a rewrite.

// Calendar week starting Monday (UTC), not ISO-8601 week numbering —
// deliberate choice, consistent with the ONE existing weekly-bucketing
// convention already in this app (charts.tsx's Trend chart): ISO week
// numbers (e.g. "2026-W27") are precise but unfamiliar to read at a
// glance, and have year-boundary edge cases (ISO week 1 of a year can
// start in December). A plain Monday–Sunday date-range label is
// unambiguous for a business report and matches what's already shipped,
// not a new convention invented for this page.
export function weekStart(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diffToMonday = (day + 6) % 7;
  d.setUTCDate(d.getUTCDate() - diffToMonday);
  return d;
}

export interface WeekGroup {
  key: string; // "2026-06-29" — the Monday, sortable via string compare
  label: string; // "Jun 29 – Jul 5, 2026"
}

export function weekKeyAndLabel(date: Date): WeekGroup {
  const start = weekStart(date);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);

  const key = start.toISOString().slice(0, 10);
  const startLabel = start.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const endLabel = end.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  return { key, label: `${startLabel} – ${endLabel}` };
}
