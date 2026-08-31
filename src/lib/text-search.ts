// Case-insensitive substring match across several fields, joined into one
// haystack. Extracted so Audit Log's and Archive's search boxes share the
// exact same matching behavior rather than each having its own copy of
// the same trim/lowercase/join logic (2026-08-31, when Archive's search
// box was added to reuse Audit Log's, not reimplement it).
export function matchesSearch(query: string, fields: (string | null | undefined)[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = fields.map((v) => (v ?? "").toLowerCase()).join(" ");
  return haystack.includes(q);
}
