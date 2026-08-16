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
  label: string; // "Week 5 (Jun 29–Jul 5)"
}

// A week's number resets to 1 at the start of each calendar month and
// counts consecutive Monday-start weeks from there, keyed off the
// week's START date's month — NOT the week containing the 1st. If the
// 1st doesn't fall on a Monday, the week containing it starts in the
// PREVIOUS month and belongs there (e.g. May 25 – May 31 stays May's
// last week even though the 1st of June falls inside it); that
// previous-month week is skipped when counting this month's weeks, so
// "Week 1" of a month is always the first Monday-start week whose own
// start date is on or after the 1st.
function weekOfMonth(start: Date): number {
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth();
  const firstOfMonth = new Date(Date.UTC(year, month, 1));
  let week1Start = weekStart(firstOfMonth);
  if (week1Start.getTime() < firstOfMonth.getTime()) {
    week1Start = new Date(week1Start);
    week1Start.setUTCDate(week1Start.getUTCDate() + 7);
  }
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  return Math.round((start.getTime() - week1Start.getTime()) / msPerWeek) + 1;
}

export function weekKeyAndLabel(date: Date): WeekGroup {
  const start = weekStart(date);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);

  const key = start.toISOString().slice(0, 10);

  // Real start/end dates kept as the parenthetical, exactly as before —
  // only the "Week N" prefix is new. A week is assigned to whichever
  // month its START date falls in (per weekOfMonth above), so a
  // month-spanning week (e.g. "Jun 29 – Jul 5") is numbered as a June
  // week even though its end date reads July.
  const startMonth = start.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  const sameMonth = start.getUTCMonth() === end.getUTCMonth() && start.getUTCFullYear() === end.getUTCFullYear();
  const range = sameMonth
    ? `${startMonth} ${start.getUTCDate()}–${end.getUTCDate()}`
    : `${startMonth} ${start.getUTCDate()}–${end.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })} ${end.getUTCDate()}`;

  return { key, label: `Week ${weekOfMonth(start)} (${range})` };
}
