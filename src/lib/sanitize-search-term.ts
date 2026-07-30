// Ports app.py's Global Search sanitization exactly:
// re.sub(r'[,()%]', ' ', term).strip()
//
// PostgREST's .or() takes a raw filter string where comma and
// parentheses are syntax (branch separators / grouping), not literal
// characters -- a search term containing them can reshape the filter's
// logic (extra OR branches, malformed queries) rather than just being
// searched for. Confirmed live: an unsanitized term with a comma and a
// parenthesis gets PGRST100 ("failed to parse logic tree") from
// PostgREST, a real 400, not a benign no-match. `%` isn't a .or()
// syntax character, but it IS the ILIKE wildcard -- left in, a user's
// own literal "%" would act as a wildcard rather than being searched
// for literally, so it's stripped for the same "don't let input
// reshape the query" reason.
//
// Verified this is the same underlying PostgREST wire protocol
// Supabase JS's .or() uses (not something the JS client parses/escapes
// differently from the Python client) -- both are thin wrappers over
// the identical `or=(...)` REST query param, confirmed by testing the
// raw REST endpoint directly.
export function sanitizeSearchTerm(term: string): string {
  return term.replace(/[,()%]/g, " ").trim();
}
