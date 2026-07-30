// Shared month-bucketing logic for CollapsibleMonthGroup consumers
// (Audit Log, My Order Tracker) — same "one shared implementation, not
// two" pattern as isGarment/parseTimestamptz/PdfPreviewButton.

export interface MonthGroup<T> {
  key: string; // "2026-07" — sortable, most-recent-first via string compare
  label: string; // "July 2026"
  items: T[];
}

// Buckets by UTC calendar month, not the viewer's local timezone.
// Appointed Time is a Ghana-based shop and Ghana runs UTC+0 year-round
// (no DST), so a UTC calendar month boundary IS the Ghana wall-clock
// month boundary, always — deterministically, regardless of what
// timezone this code happens to execute in (a viewer's browser, or a
// dev/test machine that isn't set to Ghana time). Using local Date
// getters instead would make month boundaries depend on whoever's
// machine is rendering the page, which is exactly the kind of
// unverified local-vs-UTC assumption parseTimestamptz already guards
// against for the same class of column.
export function monthKeyAndLabel(date: Date): { key: string; label: string } {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth(); // 0-11
  const key = `${year}-${String(month + 1).padStart(2, "0")}`;
  const label = date.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return { key, label };
}

export function currentMonthKey(): string {
  return monthKeyAndLabel(new Date()).key;
}

// Groups already-filtered items by month, most recent month first.
// `getDate` lets each caller decide what "this item's date" means — a
// flat Audit Log row uses its own created_at; My Order Tracker's batch
// grouping uses the batch's representative date instead of each line
// item's individually, so a multi-item batch never straddles two
// month sections.
export function groupByMonth<T>(items: T[], getDate: (item: T) => Date): MonthGroup<T>[] {
  const map = new Map<string, { label: string; items: T[] }>();
  for (const item of items) {
    const { key, label } = monthKeyAndLabel(getDate(item));
    let bucket = map.get(key);
    if (!bucket) {
      bucket = { label, items: [] };
      map.set(key, bucket);
    }
    bucket.items.push(item);
  }
  return Array.from(map.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, { label, items }]) => ({ key, label, items }));
}
