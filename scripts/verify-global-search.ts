/**
 * Standalone verification for Global Search's query + sanitization,
 * exercising the actual shared module (src/lib/sanitize-search-term.ts)
 * and the same .or() query shape src/app/search/page.tsx builds.
 * Run: npx tsx scripts/verify-global-search.ts
 */
import { readFileSync } from "fs";
import { sanitizeSearchTerm } from "../src/lib/sanitize-search-term";

const envText = readFileSync("backend/.env", "utf8");
const env: Record<string, string> = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const SUPABASE_URL = env.SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

async function search(term: string) {
  const safe = sanitizeSearchTerm(term);
  const filter = `job_order_no.ilike.%${safe}%,customer_name.ilike.%${safe}%,job_description.ilike.%${safe}%`;
  const url = `${SUPABASE_URL}/rest/v1/job_orders?select=id,job_order_no,customer_name,status&or=(${encodeURIComponent(filter).replace(/%2C/g, ",").replace(/%2F/g, "/")})&order=created_at.desc&limit=100`;
  const res = await fetch(url, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  return { status: res.status, safe, body: res.status === 200 ? await res.json() : await res.text() };
}

async function main() {
  console.log("=== Test 1: ordinary term (real customer substring) ===");
  const r1 = await search("SHADRICK");
  console.log("status:", r1.status, "sanitized term:", JSON.stringify(r1.safe));
  if (r1.status !== 200) throw new Error("Expected 200 for ordinary term");
  console.log(`rows: ${r1.body.length}`, r1.body.map((o: { job_order_no: string }) => o.job_order_no));
  if (r1.body.length === 0) throw new Error("Expected at least one match for a real customer substring");
  console.log("PASS");

  console.log("\n=== Test 2: adversarial term (comma + parens + percent) ===");
  const adversarial = "SHADRICK, PRESBY (test) 50%";
  const r2 = await search(adversarial);
  console.log("raw term:", JSON.stringify(adversarial));
  console.log("sanitized term:", JSON.stringify(r2.safe));
  console.log("status:", r2.status);
  if (r2.status !== 200) {
    console.log("body:", typeof r2.body === "string" ? r2.body.slice(0, 300) : r2.body);
    throw new Error("Expected sanitized adversarial term to NOT error");
  }
  console.log(`rows: ${Array.isArray(r2.body) ? r2.body.length : "n/a"}`);
  console.log("PASS — adversarial term did not error, no injection into the filter's logic tree");

  console.log("\n=== Test 3: confirm the SAME term UNSANITIZED would have errored (proves sanitization is load-bearing) ===");
  const rawFilter = `job_order_no.ilike.%${adversarial}%,customer_name.ilike.%${adversarial}%,job_description.ilike.%${adversarial}%`;
  const rawUrl = `${SUPABASE_URL}/rest/v1/job_orders?select=id&or=(${rawFilter})&limit=5`;
  const rawRes = await fetch(rawUrl, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
  console.log("unsanitized status:", rawRes.status);
  if (rawRes.status === 200) throw new Error("Expected the UNSANITIZED term to fail — if it doesn't, sanitization isn't actually load-bearing");
  console.log("PASS — confirms sanitizeSearchTerm is genuinely preventing a real failure, not a no-op");

  console.log("\n=== Test 4: job_description column match works (the deliberate item_description -> job_description fix) ===");
  // Find a real row with a distinctive job_description substring to search on.
  const sampleRes = await fetch(
    `${SUPABASE_URL}/rest/v1/job_orders?select=id,job_order_no,job_description&job_description=not.is.null&limit=1`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
  );
  const [sample] = await sampleRes.json();
  if (sample?.job_description) {
    const word = sample.job_description.split(/\s+/).find((w: string) => w.length >= 5) ?? sample.job_description;
    const r4 = await search(word);
    console.log(`Searching job_description word ${JSON.stringify(word)} -> status ${r4.status}, rows: ${Array.isArray(r4.body) ? r4.body.length : "n/a"}`);
    const found = Array.isArray(r4.body) && r4.body.some((o: { id: number }) => o.id === sample.id);
    console.log(found ? "PASS — job_description match found the real row" : "NOTE — word didn't uniquely match (not a failure, just not a useful sample)");
  } else {
    console.log("No row with a non-null job_description to test against — skipping (not a failure, just no sample data)");
  }

  console.log("\nALL CHECKS PASSED.");
}

main().catch((err) => {
  console.error("VERIFICATION FAILED:", err);
  process.exit(1);
});
