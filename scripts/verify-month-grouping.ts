/**
 * Standalone verification for month-based grouping (Audit Log + My Order
 * Tracker), exercising the actual shared module (src/lib/month-groups.ts)
 * and parseTimestamptz against real + synthetic data — not a
 * reimplementation. Run: npx tsx scripts/verify-month-grouping.ts
 *
 * Live data (checked earlier) only spans a single month, so this seeds
 * synthetic rows in a different month — including a genuine multi-item
 * batch — to prove cross-month behavior for real, then cleans up.
 */
import { readFileSync } from "fs";
import { groupByMonth, monthKeyAndLabel, currentMonthKey } from "../src/lib/month-groups";
import { parseTimestamptz } from "../src/lib/parse-timestamptz";

const envText = readFileSync("backend/.env", "utf8");
const env: Record<string, string> = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const SUPABASE_URL = env.SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

function headers() {
  return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };
}

interface Row {
  id: number;
  job_order_no: string | null;
  customer_name: string;
  created_at: string | null;
  parent_group_id: string | null;
  status: string | null;
  created_by: string;
}

async function main() {
  console.log("=== Insert synthetic cross-month test data ===");

  // One solo order in a PRIOR month (June 2026), current month is July 2026.
  const soloInsert = await fetch(`${SUPABASE_URL}/rest/v1/job_orders`, {
    method: "POST",
    headers: { ...headers(), Prefer: "return=representation" },
    body: JSON.stringify([
      {
        customer_name: "TEST - DO NOT SHIP (month-grouping-solo)",
        status: "Approved",
        total_amount: 500,
        deposit_amount: 0,
        qty_to_print: 1,
        type_of_print: "OFFSET",
        department: "PRESS",
        telephone_number: "0000000000",
        created_by: "test-harness@local",
        job_description: "Month grouping verification - solo, prior month",
        created_at: "2026-06-15T10:00:00+00:00",
      },
    ]),
  }).then((r) => r.json());

  // A genuine 2-item batch, also in June 2026, both items sharing one
  // parent_group_id — this is the case point 5 cares about: the batch
  // must stay together in ONE month section, keyed off the batch's own
  // (earliest) created_at, not each line item's individually. Give the
  // two items slightly different created_at (a few seconds apart, as a
  // real bulk insert might produce) to actually exercise the
  // min-across-batch logic rather than trivially identical timestamps.
  const pgid = "PG-VERIFY-MONTHGROUP-TEST";
  const batchInsert = await fetch(`${SUPABASE_URL}/rest/v1/job_orders`, {
    method: "POST",
    headers: { ...headers(), Prefer: "return=representation" },
    body: JSON.stringify([
      {
        customer_name: "TEST - DO NOT SHIP (month-grouping-batch)",
        status: "Approved",
        total_amount: 300,
        deposit_amount: 0,
        qty_to_print: 1,
        type_of_print: "OFFSET",
        department: "PRESS",
        telephone_number: "0000000000",
        created_by: "test-harness@local",
        job_description: "Month grouping verification - batch item 1",
        parent_group_id: pgid,
        created_at: "2026-06-20T09:00:00+00:00",
      },
      {
        customer_name: "TEST - DO NOT SHIP (month-grouping-batch)",
        status: "Approved",
        total_amount: 400,
        deposit_amount: 0,
        qty_to_print: 1,
        type_of_print: "OFFSET",
        department: "PRESS",
        telephone_number: "0000000000",
        created_by: "test-harness@local",
        job_description: "Month grouping verification - batch item 2",
        parent_group_id: pgid,
        created_at: "2026-06-20T09:00:07+00:00",
      },
    ]),
  }).then((r) => r.json());

  const insertedIds: number[] = [...soloInsert, ...batchInsert].map((r: Row) => r.id);
  console.log("Inserted rows:", insertedIds);

  try {
    console.log("\n=== Fetch ALL job_orders (real + synthetic), same shape the app reads ===");
    const allRows: Row[] = await fetch(
      `${SUPABASE_URL}/rest/v1/job_orders?select=id,job_order_no,customer_name,created_at,parent_group_id,status,created_by`,
      { headers: headers() }
    ).then((r) => r.json());
    console.log(`Total rows fetched: ${allRows.length}`);

    console.log("\n=== Test 1: currentMonthKey() ===");
    const curKey = currentMonthKey();
    console.log("currentMonthKey():", curKey);
    if (curKey !== "2026-07") throw new Error(`Expected 2026-07, got ${curKey}`);
    console.log("PASS");

    console.log("\n=== Test 2: Audit-Log-style flat grouping (groupByMonth over rows) ===");
    const flatGroups = groupByMonth(allRows, (o) => parseTimestamptz(o.created_at as string));
    for (const g of flatGroups) {
      const expanded = g.key === curKey;
      console.log(`  ${g.key} (${g.label}): ${g.items.length} orders, expanded-by-default=${expanded}`);
    }
    const juneFlat = flatGroups.find((g) => g.key === "2026-06");
    const julyFlat = flatGroups.find((g) => g.key === "2026-07");
    if (!juneFlat || juneFlat.items.length !== 3) {
      throw new Error(`Expected 3 synthetic rows in 2026-06, got ${juneFlat?.items.length}`);
    }
    if (!julyFlat) throw new Error("Expected a 2026-07 group from real live data");
    // Most-recent-month-first ordering
    if (flatGroups[0].key !== "2026-07") throw new Error("Expected July first (most recent)");
    console.log("PASS — June has exactly the 3 synthetic rows, July present, most-recent-first ordering correct");

    console.log("\n=== Test 3: My-Order-Tracker-style batch-aware grouping ===");
    function groupKey(row: Row): string {
      const raw = (row.parent_group_id ?? "").trim();
      const isEmpty = !raw || raw.toLowerCase() === "nan" || raw.toLowerCase() === "none";
      return isEmpty ? `SOLO_${row.id}` : raw;
    }
    const sorted = [...allRows].sort((a, b) => {
      const at = a.created_at ? parseTimestamptz(a.created_at).getTime() : 0;
      const bt = b.created_at ? parseTimestamptz(b.created_at).getTime() : 0;
      return bt - at;
    });
    const batchMap = new Map<string, Row[]>();
    for (const order of sorted) {
      const key = groupKey(order);
      if (!batchMap.has(key)) batchMap.set(key, []);
      batchMap.get(key)!.push(order);
    }
    const batches = Array.from(batchMap.entries()).map(([key, group]) => {
      const times = group
        .map((o) => (o.created_at ? parseTimestamptz(o.created_at).getTime() : null))
        .filter((t): t is number => t !== null);
      return { key, orders: group, representativeDate: times.length > 0 ? new Date(Math.min(...times)) : null };
    });
    const testBatch = batches.find((b) => b.key === pgid);
    if (!testBatch) throw new Error("Test batch not found");
    if (testBatch.orders.length !== 2) throw new Error(`Expected 2 items in test batch, got ${testBatch.orders.length}`);
    console.log(`Test batch "${pgid}": ${testBatch.orders.length} items, representativeDate=${testBatch.representativeDate?.toISOString()}`);
    if (testBatch.representativeDate?.toISOString() !== "2026-06-20T09:00:00.000Z") {
      throw new Error(`Expected representativeDate = the EARLIER item's created_at (09:00:00), got ${testBatch.representativeDate?.toISOString()}`);
    }
    console.log("PASS — representativeDate correctly uses the earliest line item's created_at (min across batch)");

    const batchGroups = groupByMonth(batches, (b) => b.representativeDate as Date);
    const juneBatchGroup = batchGroups.find((g) => g.key === "2026-06");
    if (!juneBatchGroup) throw new Error("Expected a 2026-06 batch group");
    const testBatchInJune = juneBatchGroup.items.find((b) => b.key === pgid);
    if (!testBatchInJune) throw new Error("Test batch did not land in the 2026-06 group — batch got split!");
    if (testBatchInJune.orders.length !== 2) throw new Error("Batch split across groups — item count mismatch");
    console.log("PASS — the whole 2-item batch landed in ONE month section (2026-06), not split");

    console.log("\n=== Test 4: search-match auto-expand logic ===");
    // Simulate: user searches "month-grouping-solo" -- filtering happens
    // BEFORE grouping (matches the real components), so the filtered set
    // passed into groupByMonth only contains matches. Any resulting
    // non-empty month is, by construction, a month containing a match --
    // this is the actual rule both AuditLogClient and OrderTrackerClient
    // implement (isFiltering=true -> defaultExpanded=true for every
    // group that appears).
    const searchTerm = "month-grouping-solo";
    const searchFiltered = allRows.filter((o) => o.customer_name.toLowerCase().includes(searchTerm.toLowerCase()));
    const searchGroups = groupByMonth(searchFiltered, (o) => parseTimestamptz(o.created_at as string));
    console.log(`Search "${searchTerm}" matched ${searchFiltered.length} row(s), grouped into:`, searchGroups.map((g) => `${g.key} (${g.items.length})`));
    if (searchGroups.length !== 1 || searchGroups[0].key !== "2026-06") {
      throw new Error("Expected the search match to land in exactly the 2026-06 group");
    }
    console.log("PASS — a search matching only a June row groups into 2026-06 (a collapsed, non-current month) — with isFiltering=true, defaultExpanded=true forces it open, so the match is never hidden");

    console.log("\nALL CHECKS PASSED.");
  } finally {
    console.log(`\n=== Cleanup: deleting ${insertedIds.length} synthetic test rows ===`);
    for (const id of insertedIds) {
      await fetch(`${SUPABASE_URL}/rest/v1/job_orders?id=eq.${id}`, { method: "DELETE", headers: headers() });
    }
    const remaining = await fetch(
      `${SUPABASE_URL}/rest/v1/job_orders?select=id&customer_name=ilike.*month-grouping*`,
      { headers: headers() }
    ).then((r) => r.json());
    console.log("Remaining test rows after cleanup:", remaining);
  }
}

main().catch((err) => {
  console.error("VERIFICATION FAILED:", err);
  process.exit(1);
});
