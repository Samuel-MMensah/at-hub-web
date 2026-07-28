// Shared by every route that reads a Postgres `timestamp with time zone`
// column through PostgREST (jobs.finish_time / revised_finish today —
// Production Board and Shop Floor Control will hit the same columns).
//
// PostgREST is documented to always serialize timestamptz with an explicit
// UTC offset, but that's never been checked against a live row (jobs was
// empty for the whole session this was built in — see MIGRATION_STATUS.md's
// "Known gaps"). Parse defensively instead of trusting new Date() on an
// unverified format: bare `new Date("2026-01-01T10:00:00")` (no offset) is
// silently interpreted as LOCAL time by JS, not UTC — exactly the kind of
// silent-wrong-answer failure mode app.py's own naive-isoformat quirk warns
// about. If a value ever arrives without an offset, treat it as UTC (what
// timestamptz actually stores) and log loudly so the assumption gets
// caught, not left silent.
export function parseTimestamptz(raw: string): Date {
  const hasOffset = /Z$|[+-]\d{2}:?\d{2}$/.test(raw.trim());
  if (!hasOffset) {
    console.error(
      `parseTimestamptz: "${raw}" has no timezone offset — expected PostgREST to always ` +
        "include one for a timestamptz column. Treating as UTC (matching what the column " +
        "actually stores) rather than JS Date's local-time default. This log firing means " +
        "the real wire format differs from what was assumed — verify before trusting any " +
        "date/time value computed from it."
    );
    return new Date(`${raw.trim()}Z`);
  }
  return new Date(raw);
}
