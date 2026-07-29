// Matches app.py's update_order_lifecycle_status():
//   datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')
// Stored as text on job_orders (production_start_date/ready_date/
// delivered_date), not a native timestamptz — the format has to match
// exactly since it's a plain string column, confirmed against a live
// row's actual value ("2026-07-28 14:29:58 UTC").
export function formatLifecycleTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(
    date.getUTCHours()
  )}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} UTC`;
}

// Inverse of the above — parses a lifecycle-style TEXT timestamp
// ("YYYY-MM-DD HH:MM:SS UTC") back into a Date. Needed wherever one of
// these columns (approval_date, production_start_date, ready_date,
// delivered_date, ...) has to be measured/compared, not just displayed —
// e.g. My Order Tracker's Avg Days to Approval, confirmed live to need
// approval_date rather than the always-null approved_at column.
export function parseLifecycleTimestamp(raw: string): Date {
  return new Date(raw.replace(" ", "T").replace(" UTC", "Z"));
}
