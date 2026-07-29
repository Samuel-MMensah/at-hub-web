// One-off trace of a REAL Phase 1 form payload (GHANA EDUCATION
// SERVICE / P742606) through the scheduling engine, requested as an
// additional real-world check before Phase 2 wiring — separate from
// scripts/verify-scheduling.ts's hand-picked deterministic cases
// because this one intentionally uses the actual current time (matching
// what a real submission would do via
// datetime.combine(start_date, datetime.now().time())), so its output
// is not reproducible run-to-run the way the main harness is.
//
// Confirmed live beforehand: the jobs table currently has ZERO existing
// rows on any of the four machines this payload touches (SM102-CX FOUR
// COLOUR, FOLDING UNIT CONTINUOUS FOLD, POLAR MACHINE FOR BOOKS,
// PEDDLER SADDLE STITCH) — so every getMachineNextAvailableTime call
// below falls through to the "no backlog" branch, matching what's
// passed in (`existingJobs = []`).
//
// Notably, this payload has NEITHER Die Cutter NOR Folder Gluer
// selected, so it exercises the plain sequential "else" branch of
// add_multi_part_job's finishing loop (each stage starts right where
// the previous one finished) rather than the deliberate-deviation
// stagger rule Test 6/7 in verify-scheduling.ts already covered.
import { buildMultiPartJobRecords, MACHINE_DATA } from "../src/app/production-layout/scheduling";

function fmt(d: Date): string {
  return d.toUTCString();
}

// Mirrors combineDateWithNowAsUtc (shop-floor-client.tsx) /
// add_multi_part_job's own anchor_start construction:
// datetime.combine(start_date, datetime.now().time()).replace(tzinfo=timezone.utc)
// — the picked date's Y/M/D + the operator's CURRENT wall-clock
// time-of-day, labeled UTC without converting.
function combineDateWithNowAsUtc(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  const now = new Date();
  return new Date(Date.UTC(y, m - 1, d, now.getHours(), now.getMinutes(), now.getSeconds()));
}

const payload = {
  name: "GHANA EDUCATION SERVICE",
  jobOrderNo: "P742606",
  salesRep: "m.seidu@appointedtime.com.gh",
  startDateStr: "2026-07-29",
  totalQty: 50_000,
  typeId: 1,
  totalVal: 150_000,
  components: [{ machines: ["SM102-CX FOUR COLOUR"], impressions: 50_000 }],
  finishingMachines: ["FOLDING UNIT CONTINUOUS FOLD", "POLAR MACHINE FOR BOOKS", "PEDDLER SADDLE STITCH"],
};

const anchorStart = combineDateWithNowAsUtc(payload.startDateStr);

console.log("=".repeat(70));
console.log("Tracing the real GHANA EDUCATION SERVICE / P742606 payload");
console.log("=".repeat(70));
console.log(`anchor_start (picked date "${payload.startDateStr}" + current wall-clock time, UTC-labeled):`);
console.log(`  ${fmt(anchorStart)}`);
console.log(`\nExisting backlog on every machine this job touches: NONE (confirmed live) — every`);
console.log(`getMachineNextAvailableTime call below therefore just applies calendar bounds to its`);
console.log(`requested start, it never gets overridden by another job's finish_time.\n`);

const records = buildMultiPartJobRecords(
  {
    name: payload.name,
    jobOrderNo: payload.jobOrderNo,
    salesRep: payload.salesRep,
    totalQty: payload.totalQty,
    typeId: payload.typeId,
    totalVal: payload.totalVal,
    components: payload.components,
    finishingMachines: payload.finishingMachines,
    anchorStart,
  },
  [],
  "JOB-TRACE-P742606"
);

console.log("Stage-by-stage (each 'else'-branch stage starts right where the previous one");
console.log("finished, since neither Die Cutter nor Folder Gluer is selected this time):\n");

let prevFinish = anchorStart;
for (const r of records) {
  const spec = MACHINE_DATA[r.machine];
  const start = new Date(r.start_time);
  const finish = new Date(r.finish_time);
  const hoursNeeded = r.impressions / spec.rate;
  console.log(`seq ${r.sequence_no}: ${r.machine}`);
  console.log(`  rate=${spec.rate}/hr, setup=${spec.setupHours}h, impressions=${r.impressions.toLocaleString()}`);
  console.log(`  requested start (= previous stage's finish, bounds-snapped): ${fmt(prevFinish)}`);
  console.log(`  ACTUAL start:  ${fmt(start)}`);
  console.log(`  hand math: start + setup(${spec.setupHours}h) + production(${r.impressions}/${spec.rate}=${hoursNeeded.toFixed(4)}h),`);
  console.log(`             rolling to the next working day whenever a day's remaining shift hours run out`);
  console.log(`  ACTUAL finish: ${fmt(finish)}`);
  console.log();
  prevFinish = finish;
}

console.log("Compare each ACTUAL start against the previous stage's ACTUAL finish (bounds-snapped)");
console.log("and each ACTUAL finish against its own setup+production hand math, same as the main harness.");
